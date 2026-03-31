# 🎯 JobHunter

A Chrome extension for tracking your job applications — save listings from LinkedIn, Indeed, and other job boards, auto-fill applications with your profile data, and manage everything from a clean dashboard.

---

## Features

- **Sidebar panel** — toggleable sidebar (Alt+J) on job listing pages showing detected job info, resume selection, and auto-fill controls
- **Smart auto-fill** — scans all form fields on the page, uses fuzzy matching to fill profile data, common Q&A answers, and uploads the right resume
- **4 resume types** — Cloud & Infrastructure, IT Management, Executive, and Staffing — auto-detected by job title and company
- **Work experience with resume-type variants** — each work history entry supports different titles and descriptions per resume type, so your Cloud resume highlights infrastructure while your Executive resume emphasizes leadership
- **ATS login credentials** — store a default username/password for auto-login on Workday, Greenhouse, Taleo, and other ATS portals
- **Custom Q&A pairs** — add unlimited question/answer pairs for application fields the built-in rules don't cover
- **Claude CLI integration** — for unrecognized fields, the companion server wraps your local `claude` CLI to generate answers from your profile context
- **Full dashboard** — sortable table view of all your applications with search and status filtering
- **Status tracking** — move jobs through Saved → Applied → Interview → Offer → Rejected
- **Notes & salary** — attach notes and compensation details to any job
- **Stats bar** — live counts for each status + interview rate calculation
- **CSV export** — export all your jobs to a spreadsheet

---

## Installation

Since this extension isn't on the Chrome Web Store, you'll load it manually in developer mode:

1. Download or clone this repo
   ```powershell
   git clone https://github.com/TheSaltyKorean/JobHunter.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Toggle **Developer mode** on (top-right corner)
4. Click **Load unpacked**
5. Select the `JobHunter` folder you cloned
6. The 🎯 icon will appear in your toolbar — pin it for easy access

---

## Setup

### 1. Add your resumes

Place your resume PDF files in the `resumes/` folder with these exact filenames:

```
resumes/
  cloud.pdf         # Cloud & Infrastructure resume
  it-mgmt.pdf       # IT Management resume
  executive.pdf     # Executive resume
  staffing.pdf      # Staffing / Contract resume
```

After adding files, **reload the extension** in `chrome://extensions` (click the refresh icon).
Open Settings to confirm each resume shows **Found** (green).

### 2. Fill out your profile

Click the extension icon → **Settings** and fill in:
- **Your Profile** — name, email, phone, address, location, LinkedIn, title
- **ATS Login Credentials** — default email/username/password for application portals
- **Work Experience** — add entries with per-resume-type title/description variants, dates, and current-job flag
- **Common Application Answers** — work authorization, salary, experience, education, EEO fields
- **Custom Q&A Pairs** — add any question/answer pairs for fields specific to your job search

### 3. Claude CLI companion server (optional)

For unrecognized application fields, JobHunter can ask Claude to generate answers using your existing Claude subscription (no API key needed).

```powershell
cd path\to\JobHunter
python .\claude_server.py
```

Options:
```powershell
python .\claude_server.py --port 4000   # custom port (default: 3847)
```

The server must be running for Claude-powered answers to work. Check the connection status in Settings.

**Requires:** Python 3.7+ and the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

---

## Usage

### Auto-filling an application

1. Browse to any job posting on a supported site
2. The sidebar appears on the right showing the detected job and suggested resume type
3. Click **Auto-Fill Application** — the extension will:
   - Upload the matched resume PDF
   - Fill all detected profile fields (name, email, phone, address, etc.)
   - Fill work experience sections with resume-type-appropriate titles and descriptions
   - Auto-check consent/agreement/terms checkboxes
   - Handle state abbreviation ↔ full name conversion for dropdowns
   - Auto-login with saved ATS credentials
   - Answer common questions via fuzzy matching
   - Ask Claude for any remaining unknown fields (if the server is running)
4. Review the filled fields and click **Mark as Applied**

The extension also tracks job context across site navigation — when you click "Apply" on LinkedIn and get redirected to a Workday portal, the job title, company, and location carry over automatically.

### Keyboard shortcut

Press **Alt+J** to toggle the sidebar on/off.

### Opening the dashboard

Click the extension icon in the toolbar → click **Dashboard**

---

## Data & Privacy

All data is stored **locally on your machine** using `chrome.storage.local`. The only network call is to `localhost` when the Claude CLI companion server is running — nothing is sent to external servers from the extension itself.

---

## File Structure

```
JobHunter/
├── manifest.json              # Extension manifest (MV3)
├── background.js              # Service worker — job detection, Q&A matching, storage
├── content.js                 # Sidebar panel + smart auto-fill engine
├── content.css                # Sidebar and toast styles
├── claude_server.py           # Claude CLI companion server (Python)
├── resumes/                   # Drop your resume PDFs here
│   ├── README.txt
│   ├── cloud.pdf
│   ├── it-mgmt.pdf
│   ├── executive.pdf
│   └── staffing.pdf
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html             # Toolbar popup
│   └── popup.js
├── options/
│   ├── options.html           # Profile, Q&A, resume config, Claude settings
│   └── options.js
└── dashboard/
    ├── dashboard.html         # Full job tracker dashboard
    └── dashboard.js
```

---

## Supported Sites

The sidebar activates on these job boards:

- LinkedIn Jobs
- Indeed
- Greenhouse (`boards.greenhouse.io`)
- Lever (`jobs.lever.co`)
- Workday (`*.myworkdayjobs.com`)
- Glassdoor
- SmartRecruiters
- Ashby HQ
- iCIMS
- Taleo
- BambooHR
- Jobvite
- Recruitee
- Workable

---

## Contributing

PRs welcome. To run locally, just follow the Installation steps above — no build step required, it's plain HTML/CSS/JS.

Some areas where contributions would be especially useful:

- Additional ATS site support (field patterns, site-specific extractors)
- Improved fuzzy matching for uncommon application questions
- UI/UX improvements to the sidebar and dashboard
- Better date field handling across different ATS date picker implementations

---

## License

MIT
