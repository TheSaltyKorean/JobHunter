# Setup Guide

This guide walks you through setting up JobApplicationBot on your machine.

## Prerequisites

- Python 3.10+ installed and on your PATH
- Git (to clone the repo)
- A LinkedIn account (for job searching)
- Chrome or Chromium browser (Playwright installs its own, but having Chrome helps for getting cookies)

## Step 1: Clone and Install

```bash
git clone https://github.com/TheSaltyKorean/JobApplications.git
cd JobApplications
pip install -r requirements.txt
playwright install chromium
```

On Windows, you can run `.\install.ps1` instead which handles everything.

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

### Resumes

List paths to your PDF resumes. The bot picks the right one based on the job:

```yaml
resumes:
  executive: "resumes/Jane Smith - Executive.pdf"
  it_manager: "resumes/Jane Smith - Tech Leader.pdf"
  cloud: "resumes/Jane Smith - Cloud.pdf"
  contract: "resumes/Jane Smith - Contract.pdf"
```

At minimum, provide an `it_manager` resume — it's the default fallback.

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

## Step 3: Add Your Resumes

Create the `resumes/` directory and place your PDF files there:

```bash
mkdir resumes
# Copy your resume PDFs into this directory
```

Make sure the filenames match exactly what's in your `profile.yaml`.

## Step 4: Start the App

```bash
python main.py
```

The dashboard opens in your browser at `http://localhost:5000`.

## Step 5: Configure Settings

In the web dashboard, go to **Settings** and configure:

### LinkedIn Cookie (Required for LinkedIn search)

1. Open Chrome and log into LinkedIn
2. Open DevTools (F12 or Ctrl+Shift+I)
3. Go to Application tab, then Cookies, then `linkedin.com`
4. Find the `li_at` cookie and copy its value
5. Paste it into the LinkedIn Session Cookie field in Settings

This cookie expires periodically — you'll need to refresh it occasionally.

### ATS Credentials (Optional but recommended)

Most job applications redirect to ATS platforms (Workday, Taleo, etc.) that require an account. You can pre-set your credentials in Settings:

1. Scroll to "ATS Platform Credentials"
2. Select the platform, enter your email, username (if different from email), and password
3. Click Add

If you leave the password blank, the bot auto-generates a secure one. The bot also auto-creates accounts when it encounters a new ATS during applications.

**Taleo note**: Oracle/Taleo uses a username for login, not your email. Make sure to fill in the Username field.

### Email Notifications (Optional)

Configure IMAP to monitor your inbox for job alert emails, and SMTP to receive notifications. Quick presets are available for Outlook/Live and Gmail.

For Outlook: use an App Password from your Microsoft account settings.
For Gmail: enable 2FA and create an App Password.

### Claude AI (Optional)

For fully automated screening question answers:

- **Best**: Install Claude CLI (`npm install -g @anthropic-ai/claude-code`)
- **Good**: Enter an Anthropic API key in Settings
- **Fallback**: The bot copies questions to your clipboard and you paste answers via Claude.ai

## Step 6: Search for Jobs

1. Click **Search** in the nav bar
2. Enter your target job titles (one per line)
3. Set your location
4. Check LinkedIn and/or Indeed
5. Click Search

Jobs appear in the Jobs list as they're processed. The bot filters out irrelevant roles and scores each job against your skills.

## Step 7: Apply

Review jobs in the **Jobs** page. For each one you want to apply to:

- Click **Queue** to add it to the batch queue, then click **Apply Queue** to process all at once
- Or click **Apply Now** to apply immediately

The bot opens a browser, fills out the application, uploads your resume, and answers screening questions.

## Network Access

The app binds to `0.0.0.0:5000` so you can access it from any device on your local network. Just use `http://<server-ip>:5000` from another computer or phone.

## Auto-Search

Set a search interval in Settings (e.g., every 6 hours) to have the bot automatically search for new jobs in the background. New jobs appear in the dashboard with a notification.

## Stopping the App

Use any of these methods:
- Click **Stop** in the navbar
- Press Ctrl+C in the terminal
- Visit `http://localhost:5000/api/shutdown`
