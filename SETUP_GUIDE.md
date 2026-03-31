# Setup Guide

This guide walks you through setting up JobApplicationBot on your machine.

## Prerequisites

- Python 3.10+ installed and on your PATH
- Git (to clone the repo)
- A LinkedIn account (for job searching)
- An Indeed account (for Indeed job applications)
- Chrome or Chromium browser (Playwright installs its own, but having Chrome helps for getting cookies)

## Step 1: Clone and Install

```bash
git clone https://github.com/TheSaltyKorean/JobApplications.git
cd JobApplications
pip install -r requirements.txt
playwright install chromium
```

On Windows, you can run `.\install.ps1` instead which handles everything including Python installation if needed.

**Important**: Make sure `pyyaml` gets installed (it's in requirements.txt). If you see `No module named 'yaml'` errors, run `pip install pyyaml` manually.

## Step 2: Create Your Profile

Copy the template and fill in your details:

```bash
cp config/profile.template.yaml config/profile.yaml
```

Open `config/profile.yaml` in any text editor. Fill in every section:

### Contact Info

```yaml
contact:
  first_name: "Jane"
  last_name: "Smith"
  email_primary: "jane.smith@email.com"
  email_screening: "jane.jobs@email.com"    # Optional separate email for staffing firms
  phone_primary: "(555) 123-4567"
  phone_screening: "(555) 987-6543"          # Optional separate phone
  city: "Austin"
  state: "TX"
  state_full: "Texas"
  zip: "78701"
  linkedin: "https://www.linkedin.com/in/janesmith"
  authorized_to_work: true
  requires_sponsorship: false
  willing_to_relocate: false
  preferred_work_type: "Hybrid or Remote"
```

### Skills

List your technical and soft skills. The bot matches these against job descriptions:

```yaml
skills:
  technical:
    - "AWS"
    - "Azure"
    - "Python"
    - "Terraform"
    - "Kubernetes"
  soft:
    - "Team Leadership"
    - "Budget Management"
    - "Vendor Relations"
```

### Common Answers

Pre-build answers for frequent screening questions so the bot can answer them instantly:

```yaml
common_answers:
  salary_expectation: "180000"
  salary_min: "150000"
  hourly_rate: "100"
  work_authorization: "Yes"
  sponsorship_required: "No"
  willing_to_relocate: "No, but open to remote"
  start_date: "2 weeks notice"
  notice_period: "2 weeks"
  years_of_experience: "20"
  management_experience: "10 years managing teams of 5-50"
  highest_education: "Bachelor's in Computer Science"
  remote_preference: "Remote or Hybrid"
  veteran_status: "Not a veteran"
  disability_status: "No"
  gender: "Prefer not to say"
  ethnicity: "Prefer not to say"
```

**Note**: You do NOT need to add resume paths to `profile.yaml` manually. Upload them through the web UI in the next step.

## Step 3: Start the App

```bash
python main.py
```

The dashboard is available at `http://localhost:5000`. Open it in your browser.

## Step 4: Upload Your Resumes

1. Go to **Settings** in the dashboard
2. Scroll down to **Resumes & Routing**
3. Use the **Upload Resume** form to upload each PDF
4. Assign a key name to each (e.g. `executive`, `cloud`, `contract`, `it_manager`)

The app saves uploaded files to the `resumes/` directory and automatically updates `profile.yaml`. Any placeholder entries that point to nonexistent files are cleaned up automatically.

## Step 5: Configure Resume Routing

Still in Settings, set up **Resume Routing Rules** to control which resume is sent for each job type:

1. Add title-pattern rules with regex patterns (e.g. `\bvp\b` for VP roles → executive resume)
2. The "Indian IT Staffing Firm" rule auto-detects staffing firms and routes to your contract resume
3. Set a default fallback resume for everything else

Rules are checked in order — first match wins.

## Step 6: Configure Credentials

### LinkedIn Cookie (Required for LinkedIn search)

1. Open Chrome and log into LinkedIn
2. Open DevTools (F12 or Ctrl+Shift+I)
3. Go to Application tab, then Cookies, then `linkedin.com`
4. Find the `li_at` cookie and copy its value
5. Paste it into the LinkedIn Session Cookie field in Settings

This cookie expires periodically — you'll need to refresh it occasionally.

### Indeed Credentials (Required for Indeed applications)

1. Scroll to "ATS Platform Credentials" in Settings
2. Select **Indeed** from the platform dropdown
3. Enter your Indeed email and password
4. Click Add

The app logs into Indeed at the start of each application session. You only need one set of credentials — Indeed is a single-account platform.

### Other ATS Credentials (Optional)

For platforms like Workday, Taleo, SuccessFactors, etc., you can pre-set credentials in Settings. If you don't, the bot auto-generates a secure password and creates an account when it first encounters the platform during an application.

**Taleo note**: Oracle/Taleo uses a username for login, not your email. Make sure to fill in the Username field.

**Workday note**: Each company runs its own Workday instance, so credentials are stored per-company (e.g. `workday_microsoft`). The bot auto-detects which company instance it's applying to.

### Email Notifications (Optional)

Configure IMAP to monitor your inbox for job alert emails, and SMTP to receive notifications. Quick presets are available for Outlook/Live and Gmail.

For Outlook: use an App Password from your Microsoft account settings.
For Gmail: enable 2FA and create an App Password.

### Claude AI (Optional)

For fully automated screening question answers:

- **Best**: Install Claude CLI (`npm install -g @anthropic-ai/claude-code`)
- **Good**: Enter an Anthropic API key in Settings
- **Fallback**: The bot copies questions to your clipboard and you paste answers via Claude.ai

## Step 7: Search for Jobs

1. Click **Search** in the nav bar
2. Enter your target job titles (one per line)
3. Set your location
4. Check LinkedIn and/or Indeed
5. Click Search

Jobs appear in the Jobs list as they're processed. The bot filters out irrelevant roles and scores each job against your skills.

## Step 8: Apply

Review jobs in the **Jobs** page. For each one you want to apply to:

- Click **Queue** to add it to the batch queue, then click **Apply Queue** to process all at once
- Or click **Apply Now** to apply immediately

The bot opens a browser (if Debug Mode is on in Settings), fills out the application, uploads your resume, and answers screening questions. If a LinkedIn/Indeed job redirects to an external ATS, the bot follows the redirect automatically.

## Debug Mode

By default, **Debug Mode** is enabled in Settings. This shows the Playwright browser window during applications so you can watch what the bot is doing. Uncheck it in Settings to run headless/in the background.

## Network Access

The app binds to `0.0.0.0:5000` so you can access it from any device on your local network. Just use `http://<server-ip>:5000` from another computer or phone.

## Auto-Search

Set a search interval in Settings (e.g., every 6 hours) to have the bot automatically search for new jobs in the background. New jobs appear in the dashboard with a notification.

## Stopping the App

Use any of these methods:
- Click **Stop** in the navbar
- Press Ctrl+C in the terminal
- Visit `http://localhost:5000/api/shutdown`
