"""
Flask web dashboard for JobApplicationBot.
Runs on http://localhost:5000
"""

import asyncio
import json
import logging
import os
import sys
import threading
from pathlib import Path

from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from werkzeug.utils import secure_filename

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src import database as db
from src import job_analyzer
from src import notifier
from src import claude_helper
from src.job_pipeline import process_job, process_job_batch
from src.resume_profile import CONTACT
from src import ats_credentials

logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', os.urandom(24).hex())
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload

APP_ROOT = Path(__file__).parent.parent


# ─────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────

def _run_async(coro):
    """Run an async coroutine from a sync Flask route."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _load_settings() -> dict:
    settings_path = APP_ROOT / 'config' / 'settings.json'
    if settings_path.exists():
        with open(settings_path) as f:
            return json.load(f)
    return {}


def _save_settings(settings: dict):
    settings_path = APP_ROOT / 'config' / 'settings.json'
    settings_path.parent.mkdir(exist_ok=True)
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=2)


# ─────────────────────────────────────────────────────────
# ROUTES – Dashboard
# ─────────────────────────────────────────────────────────

@app.route('/')
def dashboard():
    stats = db.get_stats()
    recent_applied = db.get_jobs(status='applied', limit=5)
    recent_new = db.get_jobs(status='new', limit=5)
    claude_status = claude_helper.check_claude_cli()
    return render_template('dashboard.html',
                           stats=stats,
                           recent_applied=recent_applied,
                           recent_new=recent_new,
                           claude_status=claude_status,
                           contact=CONTACT)


# ─────────────────────────────────────────────────────────
# ROUTES – Jobs
# ─────────────────────────────────────────────────────────

@app.route('/jobs')
def jobs():
    status = request.args.get('status', '')
    page = int(request.args.get('page', 1))
    per_page = 20
    offset = (page - 1) * per_page

    # Default view hides skipped/failed — user can still click those tabs to see them
    if status:
        all_jobs = db.get_jobs(status=status, limit=per_page, offset=offset)
    else:
        all_jobs = db.get_jobs(exclude_statuses=['skipped'], limit=per_page, offset=offset)
    stats = db.get_stats()

    # Parse matched_skills JSON
    for j in all_jobs:
        try:
            j['matched_skills'] = json.loads(j.get('matched_skills') or '[]')
        except:
            j['matched_skills'] = []

    return render_template('jobs.html',
                           jobs=all_jobs,
                           stats=stats,
                           current_status=status,
                           page=page)


@app.route('/jobs/<int:job_id>')
def job_detail(job_id):
    job = db.get_job_by_id(job_id)
    if not job:
        return 'Job not found', 404
    try:
        job['matched_skills'] = json.loads(job.get('matched_skills') or '[]')
        job['qa_pairs'] = json.loads(job.get('qa_pairs') or '[]')
    except:
        pass
    return render_template('job_detail.html', job=job)


@app.route('/jobs/<int:job_id>/queue', methods=['POST'])
def queue_job(job_id):
    db.update_job_status(job_id, 'queued')
    flash('Job queued for application!', 'success')
    return redirect(url_for('jobs'))


@app.route('/jobs/<int:job_id>/skip', methods=['POST'])
def skip_job(job_id):
    reason = request.form.get('reason', '')
    db.update_job_status(job_id, 'skipped', reason)
    return jsonify({'ok': True})


@app.route('/jobs/<int:job_id>/apply', methods=['POST'])
def apply_job(job_id):
    """Trigger immediate application for a single job."""
    job = db.get_job_by_id(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    # Indeed can't be automated (Cloudflare captcha blocks Playwright).
    # Open in user's real browser for manual application.
    if job.get('platform') == 'indeed':
        import webbrowser
        webbrowser.open(job['url'])
        db.update_job_status(job_id, 'manual')
        return jsonify({
            'ok': True,
            'manual': True,
            'message': f"Opened in your browser — Indeed requires manual application."
        })

    db.update_job_status(job_id, 'applying')

    def run_application():
        from src.applicator import apply_to_job
        settings = _load_settings()
        result = _run_async(apply_to_job(job, settings))

        if result['success']:
            db.update_job_status(job_id, 'applied')
            if result.get('qa_pairs'):
                db.save_qa_pairs(job_id, result['qa_pairs'])
            notifier.notify_applied(job['title'], job['company'])
        else:
            db.update_job_status(job_id, 'failed', result.get('error', ''))
            notifier.notify_failed(job['title'], job['company'], result.get('error', ''))

    threading.Thread(target=run_application, daemon=True).start()
    return jsonify({'ok': True, 'message': f"Applying to {job['title']} at {job['company']}..."})


# ─────────────────────────────────────────────────────────
# ROUTES – Job Ingestion
# ─────────────────────────────────────────────────────────

@app.route('/add-url', methods=['GET', 'POST'])
def add_url():
    """Manually add a job URL."""
    if request.method == 'POST':
        url = request.form.get('url', '').strip()
        if not url:
            flash('Please enter a URL', 'error')
            return redirect(url_for('add_url'))

        if db.is_duplicate(url):
            flash('This job URL has already been added', 'warning')
            return redirect(url_for('jobs'))

        def fetch_and_add():
            from src.job_searcher import fetch_job_from_url
            job_data = _run_async(fetch_job_from_url(url))
            if job_data:
                process_job(job_data)
                # Auto-queue manually added URLs — user added it so they want to apply
                # (override the pipeline's status decision)
                with db.get_conn() as conn:
                    row = conn.execute('SELECT id FROM jobs WHERE url=?', (url,)).fetchone()
                    if row:
                        db.update_job_status(row['id'], 'queued', 'Manually added via URL')

        threading.Thread(target=fetch_and_add, daemon=True).start()
        flash(f'Job URL submitted for processing: {url}', 'success')
        return redirect(url_for('jobs'))

    return render_template('add_url.html')


@app.route('/search', methods=['GET', 'POST'])
def search():
    """Trigger a job search on LinkedIn and/or Indeed."""
    settings = _load_settings()

    if request.method == 'POST':
        # Textarea sends one string with newlines — split into individual keywords
        raw_keywords = request.form.get('keywords', '')
        keywords = [k.strip() for k in raw_keywords.splitlines() if k.strip()]
        location = request.form.get('location', settings.get('default_location', 'Austin, TX'))
        platforms = request.form.getlist('platforms')

        if not keywords:
            keywords = settings.get('default_keywords', [
                'IT Director', 'VP of IT', 'Head of Cloud', 'Director of Infrastructure',
                'IT Manager', 'Cloud Manager', 'Director of Technology'
            ])

        def run_search():
            from src.job_searcher import search_linkedin, search_indeed
            all_jobs = []
            seen_urls = set()

            # LinkedIn: single browser session handles all keywords internally
            if 'linkedin' in platforms:
                try:
                    logger.info(f"Searching LinkedIn for {len(keywords)} keywords: {keywords}")
                    li_jobs = _run_async(search_linkedin(
                        keywords, location,
                        li_session_cookie=settings.get('linkedin_session_cookie', '')
                    )) or []
                    for job in li_jobs:
                        if job['url'] not in seen_urls:
                            seen_urls.add(job['url'])
                            all_jobs.append(job)
                    logger.info(f"  LinkedIn total: {len(li_jobs)} jobs")
                except Exception as e:
                    logger.error(f"  LinkedIn search failed: {e}")

            # Indeed: search each keyword individually
            if 'indeed' in platforms:
                for keyword in keywords:
                    try:
                        logger.info(f"Searching Indeed for: {keyword}")
                        indeed_jobs = _run_async(search_indeed([keyword], location))
                        for job in indeed_jobs:
                            if job['url'] not in seen_urls:
                                seen_urls.add(job['url'])
                                all_jobs.append(job)
                        logger.info(f"  Indeed '{keyword}': {len(indeed_jobs)} jobs")
                    except Exception as e:
                        logger.error(f"  Indeed '{keyword}' failed: {e}")

            logger.info(f"Total unique jobs found: {len(all_jobs)}")

            # Fetch full descriptions for jobs that don't have them
            import time as _time
            desc_fetch_count = 0
            for job_data in all_jobs:
                if db.is_duplicate(job_data.get('url', '')):
                    continue
                description = job_data.get('description', '')
                if not description:
                    try:
                        if job_data['platform'] == 'linkedin':
                            from src.job_searcher import fetch_linkedin_description
                            description = _run_async(fetch_linkedin_description(
                                job_data['url'],
                                settings.get('linkedin_session_cookie', '')
                            ))
                        elif job_data['platform'] == 'indeed':
                            from src.job_searcher import fetch_indeed_description
                            description = _run_async(fetch_indeed_description(job_data['url']))
                        job_data['description'] = description
                        desc_fetch_count += 1
                        # Delay between fetches to avoid rate limiting
                        if desc_fetch_count < len(all_jobs):
                            _time.sleep(2)
                    except Exception as e:
                        logger.error(f"Failed to fetch description for {job_data['url']}: {e}")

            new_count = process_job_batch(all_jobs)
            logger.info(f"Search complete: {len(all_jobs)} total, {new_count} new qualifying jobs")

            if new_count > 0:
                notifier.notify_jobs_found(new_count, ', '.join(platforms))

        threading.Thread(target=run_search, daemon=True).start()
        flash(f"Search started for: {', '.join(keywords[:3])}... Results will appear in the jobs list.", 'success')
        return redirect(url_for('jobs'))

    default_keywords = settings.get('default_keywords', [
        'IT Director', 'VP of IT', 'Head of Cloud', 'Director of Infrastructure',
        'Cloud Manager', 'Director of Technology', 'VP of Technology'
    ])
    return render_template('search.html',
                           default_keywords=default_keywords,
                           settings=settings)


# ─────────────────────────────────────────────────────────
# ROUTES – Answer submission (clipboard mode)
# ─────────────────────────────────────────────────────────

@app.route('/answer', methods=['GET', 'POST'])
def answer():
    """Page for Randy to paste Claude.ai answers when in clipboard mode."""
    pending_path = APP_ROOT / 'data' / 'pending_question.json'
    pending = {}
    if pending_path.exists():
        with open(pending_path) as f:
            pending = json.load(f)

    if request.method == 'POST':
        q_hash = request.form.get('hash', '')
        answer_text = request.form.get('answer', '').strip()
        if q_hash and answer_text:
            answer_path = APP_ROOT / 'data' / f'answer_{q_hash}.txt'
            answer_path.write_text(answer_text, encoding='utf-8')
            flash('Answer submitted! The application will continue.', 'success')
        return redirect(url_for('answer'))

    return render_template('answer.html', pending=pending)


# ─────────────────────────────────────────────────────────
# ROUTES – Settings
# ─────────────────────────────────────────────────────────

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        new_settings = {
            # Search
            'default_location':   request.form.get('default_location', 'Austin, TX'),
            'default_keywords':   [k.strip() for k in request.form.get('default_keywords', '').split('\n') if k.strip()],
            'min_match_score':    request.form.get('min_match_score', '50'),
            'search_interval_hours': request.form.get('search_interval_hours', '6'),

            # Salary
            'salary_expectation': request.form.get('salary_expectation', '180000'),
            'salary_min':         request.form.get('salary_min', '150000'),

            # Email (SMTP)
            'imap_host':  request.form.get('imap_host', ''),
            'imap_user':  request.form.get('imap_user', ''),
            'imap_pass':  request.form.get('imap_pass', ''),
            'smtp_host':  request.form.get('smtp_host', ''),
            'smtp_port':  request.form.get('smtp_port', '587'),
            'smtp_user':  request.form.get('smtp_user', ''),
            'smtp_pass':  request.form.get('smtp_pass', ''),
            'email_notifications': request.form.get('email_notifications', 'true'),

            # LinkedIn
            'linkedin_session_cookie': request.form.get('linkedin_session_cookie', ''),

            # Claude
            'anthropic_api_key': request.form.get('anthropic_api_key', ''),
            'use_claude_cli':    request.form.get('use_claude_cli', 'true'),

            # Automation
            'auto_apply':        request.form.get('auto_apply', 'false'),
            'auto_search':       request.form.get('auto_search', 'false'),
            'debug_mode':        request.form.get('debug_mode', 'false'),
        }
        _save_settings(new_settings)
        notifier.load_settings(new_settings)
        claude_helper.load_settings(new_settings)
        flash('Settings saved!', 'success')
        return redirect(url_for('settings'))

    current = _load_settings()
    if isinstance(current.get('default_keywords'), list):
        current['default_keywords_text'] = '\n'.join(current['default_keywords'])
    claude_status = claude_helper.check_claude_cli()
    email_presets = {
        'Outlook/Live': {'imap_host': 'outlook.office365.com', 'smtp_host': 'smtp.office365.com', 'smtp_port': 587},
        'Gmail': {'imap_host': 'imap.gmail.com', 'smtp_host': 'smtp.gmail.com', 'smtp_port': 587},
    }
    # ATS credentials for display
    ats_creds = ats_credentials.get_all_platforms()
    generated_accounts = ats_credentials.get_generated_accounts()
    # Raw passwords for show/hide toggle (keyed by platform)
    ats_passwords = {}
    raw_creds = ats_credentials._load_creds().get('platforms', {})
    for k, v in raw_creds.items():
        ats_passwords[k] = v.get('password', '')

    # Resume routing for display
    from src.resume_profile import RESUMES, _get as profile_get
    resume_files = RESUMES or {}
    resume_routing = profile_get('resume_routing', [])

    return render_template('settings.html', settings=current,
                           claude_status=claude_status, email_presets=email_presets,
                           ats_credentials=ats_creds,
                           generated_accounts=generated_accounts,
                           ats_passwords=ats_passwords,
                           resume_files=resume_files,
                           resume_routing=resume_routing)


# ─────────────────────────────────────────────────────────
# ROUTES – API endpoints (used by JS)
# ─────────────────────────────────────────────────────────

@app.route('/api/ats-credentials', methods=['POST'])
def api_ats_credentials():
    """Add or update ATS platform credentials."""
    data = request.get_json()
    platform = data.get('platform', '')
    email = data.get('email', '')
    username = data.get('username', '')
    password = data.get('password', '')

    if not platform or not email:
        return jsonify({'ok': False, 'error': 'Platform and email required'})

    if password:
        ats_credentials.set_credentials(platform, email, password, username)
    else:
        ats_credentials.get_or_create_credentials(platform, email, username)

    return jsonify({'ok': True})


@app.route('/api/stats')
def api_stats():
    return jsonify(db.get_stats())


@app.route('/api/jobs')
def api_jobs():
    status = request.args.get('status')
    jobs = db.get_jobs(status=status)
    return jsonify(jobs)


@app.route('/api/job/<int:job_id>/status', methods=['POST'])
def api_update_status(job_id):
    data = request.get_json()
    status = data.get('status')
    notes = data.get('notes', '')
    db.update_job_status(job_id, status, notes)
    return jsonify({'ok': True})


@app.route('/api/run-queue', methods=['POST'])
def api_run_queue():
    """Apply to all queued jobs."""
    queued = db.get_jobs(status='queued', limit=50)
    if not queued:
        return jsonify({'message': 'No queued jobs'})

    # Open Indeed jobs in real browser (can't automate past Cloudflare)
    import webbrowser
    indeed_count = 0
    non_indeed = []
    for job in queued:
        if job.get('platform') == 'indeed':
            webbrowser.open(job['url'])
            db.update_job_status(job['id'], 'manual')
            indeed_count += 1
        else:
            non_indeed.append(job)

    if indeed_count:
        logger.info(f"Opened {indeed_count} Indeed jobs in browser for manual application")

    def run_all():
        from src.applicator import apply_to_job
        settings = _load_settings()
        for job in non_indeed:
            db.update_job_status(job['id'], 'applying')
            result = _run_async(apply_to_job(job, settings))
            if result['success']:
                db.update_job_status(job['id'], 'applied')
                if result.get('qa_pairs'):
                    db.save_qa_pairs(job['id'], result['qa_pairs'])
                notifier.notify_applied(job['title'], job['company'])
            else:
                db.update_job_status(job['id'], 'failed', result.get('error', ''))

    if non_indeed:
        threading.Thread(target=run_all, daemon=True).start()

    parts = []
    if non_indeed:
        parts.append(f"Automating {len(non_indeed)} applications")
    if indeed_count:
        parts.append(f"Opened {indeed_count} Indeed jobs in your browser")
    return jsonify({'message': '. '.join(parts) + '.'})


@app.route('/api/resume-routing', methods=['POST'])
def api_resume_routing():
    """Update resume routing rules in profile.yaml."""
    import yaml
    data = request.get_json()
    routing = data.get('routing', [])

    profile_path = APP_ROOT / 'config' / 'profile.yaml'
    if not profile_path.exists():
        return jsonify({'ok': False, 'error': 'profile.yaml not found'})

    with open(profile_path, 'r', encoding='utf-8') as f:
        profile = yaml.safe_load(f) or {}

    profile['resume_routing'] = routing

    with open(profile_path, 'w', encoding='utf-8') as f:
        yaml.dump(profile, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    return jsonify({'ok': True})


@app.route('/api/upload-resume', methods=['POST'])
def api_upload_resume():
    """Upload a resume PDF and register it in profile.yaml."""
    try:
        return _handle_upload_resume()
    except Exception as e:
        logger.exception("Resume upload failed")
        return jsonify({'ok': False, 'error': str(e)}), 500


def _handle_upload_resume():
    import yaml

    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'No file uploaded'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'ok': False, 'error': 'No file selected'}), 400

    # Only accept PDFs
    if not f.filename.lower().endswith('.pdf'):
        return jsonify({'ok': False, 'error': 'Only PDF files are accepted'}), 400

    resume_key = request.form.get('key', '').strip()
    if not resume_key:
        # Derive key from filename: "Randy-Walker-Cloud.pdf" -> "randy_walker_cloud"
        resume_key = secure_filename(f.filename).rsplit('.', 1)[0].lower().replace('-', '_').replace(' ', '_')

    # Sanitize key to be YAML-friendly
    resume_key = resume_key.strip('_').replace('__', '_')

    # Save to resumes/ directory
    resumes_dir = APP_ROOT / 'resumes'
    resumes_dir.mkdir(exist_ok=True)
    safe_name = secure_filename(f.filename)
    dest = resumes_dir / safe_name
    f.save(str(dest))

    # Update profile.yaml
    profile_path = APP_ROOT / 'config' / 'profile.yaml'
    if not profile_path.exists():
        # Copy template if profile doesn't exist yet
        template_path = APP_ROOT / 'config' / 'profile.template.yaml'
        if template_path.exists():
            import shutil
            shutil.copy(template_path, profile_path)
        else:
            return jsonify({'ok': False, 'error': 'profile.yaml not found and no template available'}), 500

    with open(profile_path, 'r', encoding='utf-8') as fh:
        profile = yaml.safe_load(fh) or {}

    if 'resumes' not in profile or not isinstance(profile['resumes'], dict):
        profile['resumes'] = {}

    # Clean out any entries whose files don't actually exist (template placeholders)
    profile['resumes'] = {
        k: v for k, v in profile['resumes'].items()
        if (APP_ROOT / v).exists()
    }

    rel_path = f'resumes/{safe_name}'
    profile['resumes'][resume_key] = rel_path

    with open(profile_path, 'w', encoding='utf-8') as fh:
        yaml.dump(profile, fh, default_flow_style=False, allow_unicode=True, sort_keys=False)

    return jsonify({'ok': True, 'key': resume_key, 'path': rel_path, 'filename': safe_name})


@app.route('/api/delete-resume', methods=['POST'])
def api_delete_resume():
    """Remove a resume key from profile.yaml and optionally delete the file."""
    import yaml

    data = request.get_json()
    resume_key = data.get('key', '')
    delete_file = data.get('delete_file', False)

    if not resume_key:
        return jsonify({'ok': False, 'error': 'No resume key specified'}), 400

    profile_path = APP_ROOT / 'config' / 'profile.yaml'
    if not profile_path.exists():
        return jsonify({'ok': False, 'error': 'profile.yaml not found'}), 404

    with open(profile_path, 'r', encoding='utf-8') as f:
        profile = yaml.safe_load(f) or {}

    resumes = profile.get('resumes', {})
    if resume_key not in resumes:
        return jsonify({'ok': False, 'error': f'Resume key "{resume_key}" not found'}), 404

    file_path = APP_ROOT / resumes[resume_key]

    del resumes[resume_key]
    profile['resumes'] = resumes

    # Also remove from any routing rules that reference this key
    routing = profile.get('resume_routing', [])
    profile['resume_routing'] = [r for r in routing if r.get('resume') != resume_key]

    with open(profile_path, 'w', encoding='utf-8') as f:
        yaml.dump(profile, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    if delete_file and file_path.exists():
        file_path.unlink()

    return jsonify({'ok': True})


@app.route('/api/rename-resume', methods=['POST'])
def api_rename_resume():
    """Change the key name for a resume in profile.yaml."""
    import yaml

    data = request.get_json()
    old_key = data.get('old_key', '')
    new_key = data.get('new_key', '').strip().lower().replace('-', '_').replace(' ', '_')

    if not old_key or not new_key:
        return jsonify({'ok': False, 'error': 'Both old and new key required'}), 400

    profile_path = APP_ROOT / 'config' / 'profile.yaml'
    if not profile_path.exists():
        return jsonify({'ok': False, 'error': 'profile.yaml not found'}), 404

    with open(profile_path, 'r', encoding='utf-8') as f:
        profile = yaml.safe_load(f) or {}

    resumes = profile.get('resumes', {})
    if old_key not in resumes:
        return jsonify({'ok': False, 'error': f'Resume key "{old_key}" not found'}), 404

    if new_key in resumes and new_key != old_key:
        return jsonify({'ok': False, 'error': f'Key "{new_key}" already exists'}), 400

    # Preserve order: rebuild dict with new key
    new_resumes = {}
    for k, v in resumes.items():
        if k == old_key:
            new_resumes[new_key] = v
        else:
            new_resumes[k] = v
    profile['resumes'] = new_resumes

    # Update routing rules that reference the old key
    for rule in profile.get('resume_routing', []):
        if rule.get('resume') == old_key:
            rule['resume'] = new_key

    with open(profile_path, 'w', encoding='utf-8') as f:
        yaml.dump(profile, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    return jsonify({'ok': True, 'new_key': new_key})


@app.route('/api/notifications')
def api_notifications():
    """Poll for new web notifications (replaces system tray)."""
    since_id = int(request.args.get('since', 0))
    notifications = notifier.get_web_notifications(since_id)
    return jsonify(notifications)


@app.route('/api/shutdown', methods=['POST', 'GET'])
def api_shutdown():
    """Gracefully shut down the application."""
    import signal, os
    logger.info("Shutdown requested via web UI")
    # Send SIGTERM to self to trigger clean shutdown
    os.kill(os.getpid(), signal.SIGTERM)
    return jsonify({'message': 'Shutting down...'})


# ─────────────────────────────────────────────────────────
# APP STARTUP
# ─────────────────────────────────────────────────────────

def create_app():
    db.init_db()
    settings = _load_settings()
    notifier.load_settings(settings)
    claude_helper.load_settings(settings)
    return app


if __name__ == '__main__':
    create_app().run(debug=False, host='127.0.0.1', port=5000)
