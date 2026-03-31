# 🎯 JobHunter

A Chrome extension for tracking your job applications — save listings from LinkedIn, Indeed, and other job boards with one click, then manage everything from a clean dashboard.

---

## Features

- **One-click save** — click the 🎯 button injected onto job listing pages to instantly capture the title, company, location, platform, and URL
- **Full dashboard** — sortable table view of all your applications with search and status filtering
- **Status tracking** — move jobs through Saved → Applied → Interview → Offer → Rejected
- **Notes & salary** — attach notes and compensation details to any job
- **Stats bar** — live counts for each status + interview rate calculation
- **Manual entry** — add jobs that aren't on supported sites via the "+ Add Manual" form
- **CSV export** — export all your jobs to a spreadsheet
- **Dark mode** — respects your OS preference automatically

---

## Installation

Since this extension isn't on the Chrome Web Store, you'll load it manually in developer mode:

1. Download or clone this repo
   ```
   git clone https://github.com/TheSaltyKorean/JobHunter.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Toggle **Developer mode** on (top-right corner)
4. Click **Load unpacked**
5. Select the `JobHunter` folder you cloned
6. The 🎯 icon will appear in your toolbar — pin it for easy access

---

## Usage

### Saving a job from a listing page
1. Browse to any job posting (LinkedIn, Indeed, Greenhouse, Lever, Workday, etc.)
2. Click the floating **🎯** button on the page
3. The job is saved instantly — a confirmation toast appears

### Opening the dashboard
- Click the extension icon in the toolbar → click **Open Dashboard**
- Or navigate directly to the dashboard via the popup

### Updating a job's status
- From the dashboard, click any row to open the detail modal
- Change the status dropdown, add notes or salary info, then click **Save Changes**

### Exporting to CSV
- Click the **⌨ Export** button in the dashboard toolbar
- A CSV file downloads with all your current jobs

---

## Data & Privacy

All data is stored **locally on your machine** using `chrome.storage.local`. Nothing is sent to any server. Uninstalling the extension removes all stored data.

---

## File Structure

```
JobHunter/
├── manifest.json              # Extension manifest (MV3)
├── background.js              # Service worker — handles save-job messages
├── content.js                 # Injected script — adds 🎯 button to job pages
├── content.css                # Styles for the injected button and toast
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html             # Toolbar popup
│   └── popup.js
├── options/
│   ├── options.html           # Profile & settings page
│   └── options.js
└── dashboard/
    ├── dashboard.html         # Full job tracker dashboard
    └── dashboard.js
```

---

## Supported Sites

The content script activates on all pages by default. The 🎯 button appears on any page and will capture whatever job details it can detect from the page metadata. It works best on:

- LinkedIn Jobs
- Indeed
- Greenhouse (`boards.greenhouse.io`)
- Lever (`jobs.lever.co`)
- Workday
- Any job page where the title and company are in the `<h1>` or page title

---

## Contributing

PRs welcome. To run locally, just follow the Installation steps above — no build step required, it's plain HTML/CSS/JS.
