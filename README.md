# JobApplicationBot

Automated job application assistant for Randy Walker — built with Python, Flask, and Playwright.

## Features

- **Job Searching** — Automatically searches LinkedIn and Indeed for management roles
- **Smart Filtering** — Skips IC roles (Engineer, Analyst, etc.), keeps management (Director, VP, Manager, Head of)
- **Resume Selection** — Picks the right resume based on role level and company type
- **Indian IT Firm Detection** — Detects staffing firms (Infosys, Wipro, TCS, etc.) and routes them to screening contact info
- **50% Match Threshold** — Only queues jobs where ≥50% of required skills match
- **Auto Form Filling** — Fills LinkedIn Easy Apply, Workday, and Indeed forms automatically
- **Claude Q&A** — Answers screening questions via Claude CLI, API, or clipboard+Claude.ai
- **Email Monitoring** — Watches inbox for LinkedIn/Indeed job alert emails
- **Web Dashboard** — Track, review, and manage all applications at `http://localhost:5000`

## Resume Routing

| Situation | Resume Used |
|---|---|
| Indian IT staffing firm | Cloud Contract (screening contact: `jobs.randywalker@outlook.com`) |
| VP / CxO / SVP title | IT Executive |
| Cloud / Azure / Infrastructure title | Cloud |
| All other management roles | Tech Leader (IT Manager) |

## Quick Start

### Windows (PowerShell)
```powershell
.\install.ps1   # First-time setup
.\start.ps1     # Start the app
```

### Windows (Command Prompt)
```
install.bat     # First-time setup
start.bat       # Start the app
```

### Manual
```bash
pip install -r requirements.txt
playwright install chromium
python main.py
```

Then open `http://localhost:5000`

## Structure

```
JobApplicationBot/
├── main.py                  # Entry point (Flask + tray + scheduler)
├── requirements.txt
├── setup.bat / run.bat      # Windows launchers
├── config/
│   └── settings.json        # Your settings (not committed)
├── resumes/                 # Your PDF resumes (not committed)
├── src/
│   ├── resume_profile.py    # Your background, skills, and Q&A answers
│   ├── job_analyzer.py      # Role classification, skill matching, Indian firm detection
│   ├── job_searcher.py      # LinkedIn + Indeed job searching
│   ├── applicator.py        # LinkedIn Easy Apply, Workday, Indeed form filling
│   ├── claude_helper.py     # Q&A via Claude CLI / API / clipboard
│   ├── notifier.py          # Desktop + email notifications
│   ├── email_monitor.py     # IMAP job alert email monitoring
│   └── database.py          # SQLite job tracking
└── web/
    ├── app.py               # Flask routes
    ├── templates/           # Dashboard HTML
    └── static/style.css
```

## Configuration (Settings Page)

- **LinkedIn Cookie** — `li_at` cookie from Chrome DevTools for job searching
- **Email** — IMAP/SMTP for job alert monitoring and notifications
- **Claude CLI** — Run `claude --version` to check; enables full automation
- **Salary** — Set your target and minimum
- **Keywords** — Job title keywords to search for

## Claude Q&A Priority

1. Pre-built answers (salary, authorization, relocation — instant)
2. `claude` CLI — fully automated if installed
3. Anthropic API key — set in Settings
4. Clipboard + Claude.ai — semi-automated fallback

## Setup Guide

See `SETUP_GUIDE.md` for detailed instructions.
