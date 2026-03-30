# JobApplicationBot

An automated job search and application assistant built with Python, Flask, and Playwright. Searches LinkedIn and Indeed, filters jobs by relevance, fills out applications across multiple ATS platforms, and tracks your entire pipeline from discovery to offer.

## What It Does

JobApplicationBot handles the tedious parts of job hunting so you can focus on preparing for interviews:

- **Searches** LinkedIn and Indeed using your preferred job titles and location
- **Filters** out irrelevant roles (product manager, electrical engineer, sales, nursing, etc.) automatically
- **Scores** each job against your skills and experience, keeping only matches above your threshold
- **Picks the right resume** based on role level (executive, cloud, contract, management)
- **Detects staffing firms** and routes them to screening contact info and a contract resume
- **Fills applications** across LinkedIn Easy Apply, Workday, Indeed, Taleo/Oracle, SuccessFactors, Greenhouse, Lever, and more
- **Answers screening questions** using Claude AI (CLI, API, or manual clipboard mode)
- **Manages ATS credentials** per-platform, auto-generating secure passwords for new accounts
- **Tracks everything** in a web dashboard: new, queued, applied, interview, offer, rejected, ghosted

## Requirements

- Python 3.10 or higher
- Chromium (installed automatically by Playwright)
- Windows 10/11 (primary target), macOS, or Linux
- Claude CLI (optional, for fully automated Q&A) or an Anthropic API key

## Installation

### Windows (Recommended)

```powershell
# Clone the repo
git clone https://github.com/TheSaltyKorean/JobApplications.git
cd JobApplications

# Run the installer (installs Python dependencies + Playwright browsers)
.\install.ps1
```

### Manual Install (Any OS)

```bash
git clone https://github.com/TheSaltyKorean/JobApplications.git
cd JobApplications

# Install Python dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### Optional: Claude CLI

For fully automated screening question answers, install the Claude CLI:

```bash
npm install -g @anthropic-ai/claude-code
```

Without it, you can use an Anthropic API key (set in Settings) or the clipboard+Claude.ai fallback mode.

## Setup

### 1. Create Your Profile

```bash
cp config/profile.template.yaml config/profile.yaml
```

Edit `config/profile.yaml` with your information. This file controls everything the bot knows about you:

- **contact** — Name, email, phone, city/state, LinkedIn URL
- **resumes** — Paths to your PDF resumes (relative to project root)
- **education** — Schools, degrees, fields of study
- **certifications** — Professional certifications (AWS, PMP, etc.)
- **skills** — Technical and soft skills the bot matches against job descriptions
- **work_history** — Job titles, companies, date ranges, key accomplishments
- **career_summary** — Brief overview of your background
- **common_answers** — Pre-built answers for frequent screening questions (salary expectations, work authorization, relocation preference, start date, etc.)

The profile file is gitignored so your personal data never gets committed.

### 2. Add Your Resumes

Place your resume PDFs in the `resumes/` directory. The filenames must match what you put in `config/profile.yaml`:

```
resumes/
  Your Name - Tech Leader.pdf
  Your Name - Cloud.pdf
  Your Name - IT Executive.pdf
  Your Name - Cloud Contract.pdf
```

The bot picks which resume to use based on the job:

| Job Type | Resume Used |
|---|---|
| VP / CxO / SVP / Executive titles | Executive resume |
| Cloud / Azure / Infrastructure / DevOps titles | Cloud resume |
| Indian IT staffing firm (auto-detected) | Contract resume (with screening contact info) |
| All other management roles | Tech Leader / IT Manager resume |

### 3. Start the App

```powershell
# Windows
.\start.ps1

# Or directly
python main.py
```

The dashboard opens automatically at `http://localhost:5000`. You can access it from other PCs on your network at `http://<your-ip>:5000`.

### 4. Configure Settings

Open the Settings page in the dashboard to configure:

**LinkedIn Session Cookie** — Required for LinkedIn job searching. Get it from Chrome DevTools: Application tab, Cookies, `linkedin.com`, copy the `li_at` cookie value.

**ATS Platform Credentials** — Set email/username/password for each ATS platform you use (Workday, SuccessFactors, Taleo, etc.). When the bot encounters a new ATS site during applications, it auto-generates a secure password and stores it for you. Taleo uses a username instead of email for login.

**Email Notifications** — Optional IMAP/SMTP configuration for job alert monitoring and email notifications. Quick presets available for Outlook/Live and Gmail.

**Claude / AI** — Claude CLI is auto-detected. If not installed, add your Anthropic API key here.

**Job Search** — Default location, keywords, minimum match score, auto-search interval.

## Usage

### Searching for Jobs

1. Go to **Search** in the nav bar
2. Enter job title keywords (one per line) and location
3. Select platforms (LinkedIn, Indeed, or both)
4. Click Search — results appear in the Jobs list as they're processed

The bot searches each keyword individually and deduplicates results. It runs each job through the analyzer to score relevance, classify the role, and pick the right resume.

### Managing Jobs

The **Jobs** page shows all discovered jobs with tabs for each status:

- **New** — Jobs that passed filtering, ready for your review
- **Queued** — Jobs you've approved for application
- **Applied** — Applications the bot has submitted
- **Interview** — Jobs where you got an interview
- **Offer** — Jobs where you received an offer
- **Rejected / Ghosted** — Jobs that didn't work out
- **Skipped** — Jobs you dismissed (can be restored)

Click any job to see its full details, match score, matched skills, and Q&A history.

### Applying to Jobs

You can apply in two ways:

- **Apply Now** — Click on any job to apply immediately. A browser window opens and the bot fills out the application.
- **Apply Queue** — Queue multiple jobs and click "Apply Queue" to process them all in sequence.

The bot handles multi-step application forms, uploads your resume, fills personal info, and answers screening questions. If it encounters a login wall on an ATS site, it uses your stored credentials or creates a new account.

### Keyboard Shortcuts

- **Dismiss** — Instantly removes a job from your list (no confirmation dialog). Find it in the Skipped tab if you change your mind.
- **Queue** — Marks a job for batch application.
- **Column sorting** — Click any column header on the Jobs table to sort.

### Application Tracking

After applying, track your progress through the pipeline:

1. Job shows as **Applied**
2. Mark as **Got Interview** when you hear back
3. Mark as **Got Offer** or **Rejected** based on outcome
4. Mark as **Ghosted** if you never hear back

### ATS Platform Support

The bot can apply across these platforms:

| Platform | Login Required | Notes |
|---|---|---|
| LinkedIn Easy Apply | Yes (session cookie) | Multi-step modal form |
| Workday | Yes (per-company account) | Auto-creates accounts, company-specific credentials |
| Indeed | Yes (session) | Handles Indeed Apply flow |
| Oracle/Taleo | Yes (username-based login) | Multi-step, uses username not email |
| SAP SuccessFactors | Yes | Multi-step form flow |
| Greenhouse | No | Usually single-page form |
| Lever | No | Single-page form at /apply |
| iCIMS | Yes | Generic form handler |
| SmartRecruiters | Varies | Generic form handler |

When a LinkedIn or Indeed job redirects to an external ATS (e.g., "Apply on company website" goes to Workday), the bot detects the redirect and routes to the correct handler automatically.

## Architecture

```
JobApplicationBot/
├── main.py                  # Entry point — Flask server, scheduler, system tray
├── requirements.txt         # Python dependencies
├── install.ps1 / start.ps1  # Windows launchers
│
├── config/
│   ├── profile.template.yaml   # Blank profile template (committed)
│   ├── profile.yaml             # Your personal profile (gitignored)
│   ├── settings.json            # App settings (gitignored)
│   └── ats_credentials.json     # ATS login credentials (gitignored)
│
├── resumes/                     # Your PDF resumes (gitignored)
│
├── src/
│   ├── resume_profile.py    # Loads profile.yaml, exposes CONTACT, SKILLS, etc.
│   ├── job_analyzer.py      # Role classification, skill matching, scoring
│   ├── job_searcher.py      # LinkedIn + Indeed scrapers, expired job detection
│   ├── job_pipeline.py      # Analyze → score → upsert flow
│   ├── applicator.py        # Form filling for all ATS platforms
│   ├── ats_credentials.py   # Per-platform credential management
│   ├── claude_helper.py     # Q&A via Claude CLI / API / clipboard
│   ├── notifier.py          # Web + email notifications
│   ├── email_monitor.py     # IMAP job alert monitoring
│   └── database.py          # SQLite job tracking
│
└── web/
    ├── app.py               # Flask routes and API endpoints
    ├── templates/           # Jinja2 HTML templates
    └── static/style.css     # Dashboard styling
```

### Key Design Decisions

**YAML profile over hardcoded data** — All personal information lives in `config/profile.yaml` which is gitignored. The template file shows the structure without any real data.

**Per-platform ATS credentials** — Each ATS platform (Workday, Taleo, etc.) gets its own email/username/password. Workday stores credentials per-company since each company has its own Workday instance.

**HTML entities instead of emoji** — Templates use `&#x1F916;` instead of emoji characters to avoid encoding issues across different OS/git configurations.

**Toast notifications** — All confirmations and alerts use in-page toast overlays instead of browser `alert()`/`confirm()` dialogs. Background task notifications (search complete, application submitted) poll the server every 5 seconds.

**Expired job detection** — The scraper checks page text for phrases like "this job has expired" or "no longer accepting applications" and auto-skips them.

**Resume routing** — The analyzer classifies each job by level (executive, management, IC) and type (cloud, general IT), then picks the best-matching resume from your collection.

## Claude Q&A Priority

When the bot encounters a screening question it can't answer from your pre-built answers:

1. **Pre-built answers** — Instant responses for salary, work authorization, relocation, start date, years of experience, etc. (defined in `profile.yaml` under `common_answers`)
2. **Claude CLI** — Fully automated if `claude` is installed
3. **Anthropic API** — Uses the API key from Settings
4. **Clipboard + Claude.ai** — Copies the prompt to your clipboard, you paste it into Claude.ai, copy the answer, and paste it on the Answer page

## Job Filtering

The analyzer excludes jobs with titles matching patterns like:

- Product Manager, Project Manager (non-IT)
- Electrical/Mechanical/Chemical Engineer
- Sales, Marketing, Business Development
- Nursing, Medical, Pharmacy
- Accounting, Finance (non-IT)
- Help Desk, Desktop Support (too junior)
- Intern, Entry Level

This keeps your job list focused on relevant IT management and leadership roles.

## Troubleshooting

**LinkedIn not returning results** — Make sure your `li_at` session cookie is current. LinkedIn cookies expire periodically. Get a fresh one from Chrome DevTools.

**"Resume not found" errors** — Check that your resume filenames in `config/profile.yaml` exactly match the files in the `resumes/` directory (case-sensitive).

**Workday login failing** — Each company has its own Workday instance. If auto-login fails, add credentials manually in Settings. The platform key shows which company instance it's for.

**Taleo login failing** — Taleo uses a username, not email, for login. Make sure the Username field is set in your ATS credentials (Settings page).

**App won't stop** — Use the Stop button in the navbar, or visit `http://localhost:5000/api/shutdown`.

**Encoding errors in templates** — If you see `UnicodeDecodeError`, run `git checkout -- web/templates/` to force re-extract template files with correct encoding.

**Search returning 0 jobs** — Check that keywords are entered one per line in the search form (not comma-separated).

## Privacy & Security

- All personal data stays in gitignored config files — nothing is committed to the repo
- ATS passwords are stored locally in `config/ats_credentials.json` (gitignored)
- Auto-generated passwords use Python's `secrets` module (cryptographically secure)
- The app binds to `0.0.0.0` for LAN access — make sure your network is trusted
- No data is sent to external services except LinkedIn/Indeed (for searching) and Claude (for Q&A)

## License

MIT
