"""
SQLite database layer for tracking jobs and applications.
Uses context managers for safe connection handling.
"""

import sqlite3
import json
import os
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs.db')


@contextmanager
def get_conn():
    """Context manager for safe database connections."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        c = conn.cursor()

        c.execute('''
            CREATE TABLE IF NOT EXISTS jobs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id          TEXT UNIQUE,          -- platform-specific ID
                title           TEXT NOT NULL,
                company         TEXT NOT NULL,
                location        TEXT,
                job_type        TEXT,                 -- full-time, contract, etc.
                salary          TEXT,
                platform        TEXT,                 -- linkedin, indeed, workday, manual
                url             TEXT,
                description     TEXT,
                posted_date     TEXT,
                found_date      TEXT DEFAULT CURRENT_TIMESTAMP,

                -- Classification
                role_type       TEXT,                 -- management, ic, unknown
                match_score     REAL DEFAULT 0,       -- 0-100 match percentage
                matched_skills  TEXT,                 -- JSON list of matched skills
                resume_type     TEXT,                 -- executive, cloud, it_manager, contract
                is_indian_firm  INTEGER DEFAULT 0,
                flagged_reason  TEXT,

                -- Application status
                status          TEXT DEFAULT 'new',   -- new, queued, applying, applied, skipped, failed, interview, rejected, offer, ghosted
                applied_date    TEXT,
                notes           TEXT,

                -- Q&A
                qa_pairs        TEXT                  -- JSON list of {q, a} pairs
            )
        ''')

        c.execute('''
            CREATE TABLE IF NOT EXISTS search_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                searched_at TEXT DEFAULT CURRENT_TIMESTAMP,
                platform    TEXT,
                keywords    TEXT,
                location    TEXT,
                jobs_found  INTEGER DEFAULT 0
            )
        ''')


# ── Job CRUD ──────────────────────────────────────────────

def upsert_job(job: dict) -> int:
    """Insert or update a job. Returns the row id."""
    with get_conn() as conn:
        c = conn.cursor()
        c.execute('''
            INSERT INTO jobs (job_id, title, company, location, job_type, salary,
                              platform, url, description, posted_date,
                              role_type, match_score, matched_skills, resume_type,
                              is_indian_firm, flagged_reason, status, notes)
            VALUES (:job_id, :title, :company, :location, :job_type, :salary,
                    :platform, :url, :description, :posted_date,
                    :role_type, :match_score, :matched_skills, :resume_type,
                    :is_indian_firm, :flagged_reason, :status, :notes)
            ON CONFLICT(job_id) DO UPDATE SET
                title        = excluded.title,
                match_score  = excluded.match_score,
                matched_skills = excluded.matched_skills,
                resume_type  = excluded.resume_type,
                is_indian_firm = excluded.is_indian_firm,
                flagged_reason = excluded.flagged_reason
        ''', {
            'job_id':        job.get('job_id', ''),
            'title':         job.get('title', ''),
            'company':       job.get('company', ''),
            'location':      job.get('location', ''),
            'job_type':      job.get('job_type', ''),
            'salary':        job.get('salary', ''),
            'platform':      job.get('platform', ''),
            'url':           job.get('url', ''),
            'description':   job.get('description', ''),
            'posted_date':   job.get('posted_date', ''),
            'role_type':     job.get('role_type', 'unknown'),
            'match_score':   job.get('match_score', 0),
            'matched_skills': json.dumps(job.get('matched_skills', [])),
            'resume_type':   job.get('resume_type', 'it_manager'),
            'is_indian_firm': 1 if job.get('is_indian_firm') else 0,
            'flagged_reason': job.get('flagged_reason', ''),
            'status':        job.get('status', 'new'),
            'notes':         job.get('notes', ''),
        })
        return c.lastrowid


def get_jobs(status=None, limit=100, offset=0):
    with get_conn() as conn:
        if status:
            rows = conn.execute(
                'SELECT * FROM jobs WHERE status=? ORDER BY found_date DESC LIMIT ? OFFSET ?',
                (status, limit, offset)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM jobs ORDER BY found_date DESC LIMIT ? OFFSET ?',
                (limit, offset)
            ).fetchall()
        return [dict(r) for r in rows]


def get_job_by_id(row_id: int):
    with get_conn() as conn:
        row = conn.execute('SELECT * FROM jobs WHERE id=?', (row_id,)).fetchone()
        return dict(row) if row else None


def update_job_status(row_id: int, status: str, notes: str = None):
    with get_conn() as conn:
        if notes:
            conn.execute('UPDATE jobs SET status=?, notes=? WHERE id=?', (status, notes, row_id))
        else:
            conn.execute('UPDATE jobs SET status=? WHERE id=?', (status, row_id))
        if status == 'applied':
            conn.execute('UPDATE jobs SET applied_date=? WHERE id=?',
                         (datetime.now().isoformat(), row_id))


def save_qa_pairs(row_id: int, qa_pairs: list):
    with get_conn() as conn:
        conn.execute('UPDATE jobs SET qa_pairs=? WHERE id=?',
                     (json.dumps(qa_pairs), row_id))


def is_duplicate(url: str) -> bool:
    with get_conn() as conn:
        row = conn.execute('SELECT id FROM jobs WHERE url=?', (url,)).fetchone()
        return row is not None


def get_stats():
    """Get job statistics in a single query instead of 7 separate ones."""
    with get_conn() as conn:
        # Single query with conditional aggregation
        row = conn.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new,
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied,
                SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'interview' THEN 1 ELSE 0 END) as interview,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN status = 'offer' THEN 1 ELSE 0 END) as offer,
                SUM(CASE WHEN status = 'ghosted' THEN 1 ELSE 0 END) as ghosted,
                SUM(CASE WHEN is_indian_firm = 1 THEN 1 ELSE 0 END) as indian_firm,
                SUM(CASE WHEN role_type = 'management' THEN 1 ELSE 0 END) as management
            FROM jobs
        ''').fetchone()

        return {
            'total': row['total'] or 0,
            'new': row['new'] or 0,
            'queued': row['queued'] or 0,
            'applied': row['applied'] or 0,
            'skipped': row['skipped'] or 0,
            'failed': row['failed'] or 0,
            'interview': row['interview'] or 0,
            'rejected': row['rejected'] or 0,
            'offer': row['offer'] or 0,
            'ghosted': row['ghosted'] or 0,
            'indian_firm': row['indian_firm'] or 0,
            'management': row['management'] or 0,
        }
