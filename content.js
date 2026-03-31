// JobHunter — Content Script (Sidebar Mode)
// Injects a collapsible sidebar panel on job listing pages
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const JOB_TYPE_LABELS = {
    'cloud':     '☁️ Cloud & Infra',
    'it-mgmt':   '💼 IT Mgmt',
    'executive': '🏆 Executive',
    'staffing':  '🏢 Staffing',
  };

  const JOB_TYPE_KEYS = ['cloud', 'it-mgmt', 'executive', 'staffing'];

  // ── Extract job info from the current page ─────────────────────────────────
  function extractJobInfo() {
    const url      = location.href;
    const hostname = location.hostname.replace(/^www\./, '');

    let title = '';
    const ldJson = document.querySelector('script[type="application/ld+json"]');
    if (ldJson) {
      try {
        const d = JSON.parse(ldJson.textContent);
        title = d.title || d.name || '';
      } catch (_) {}
    }
    if (!title) title = document.querySelector('h1')?.innerText?.trim() || '';
    if (!title) title = document.title.split(/[-|–]/)[0].trim();

    let company = '';
    company = document.querySelector('meta[property="og:site_name"]')?.content || '';
    if (!company) {
      const selectors = [
        '[data-company]','[class*="company-name"]','[class*="CompanyName"]',
        '[class*="employer"]','[itemprop="hiringOrganization"]',
        '.jobs-unified-top-card__company-name',
        '[data-testid="inlineHeader-companyName"]',
        '.company-name',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el?.innerText?.trim()) { company = el.innerText.trim(); break; }
      }
    }

    let loc = '';
    const locSelectors = [
      '[class*="location"]','[class*="Location"]',
      '[data-testid="job-location"]',
      '.jobs-unified-top-card__bullet',
    ];
    for (const s of locSelectors) {
      const el = document.querySelector(s);
      if (el?.innerText?.trim()) { loc = el.innerText.trim(); break; }
    }

    let platform = hostname;
    if (hostname.includes('linkedin'))         platform = 'LinkedIn';
    else if (hostname.includes('indeed'))      platform = 'Indeed';
    else if (hostname.includes('greenhouse'))  platform = 'Greenhouse';
    else if (hostname.includes('lever'))       platform = 'Lever';
    else if (hostname.includes('workday'))     platform = 'Workday';
    else if (hostname.includes('smartrecruiter')) platform = 'SmartRecruiters';
    else if (hostname.includes('jobvite'))     platform = 'Jobvite';
    else if (hostname.includes('icims'))       platform = 'iCIMS';
    else if (hostname.includes('taleo'))       platform = 'Taleo';

    return { title, company, location: loc, platform, url };
  }

  // ── Toast notification ─────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    let toast = document.getElementById('jh-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'jh-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className   = `jh-toast jh-toast-${type} jh-toast-show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = 'jh-toast'; }, 3000);
  }

  // ── Build the sidebar ──────────────────────────────────────────────────────
  function createSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'jh-sidebar';
    sidebar.className = 'jh-sidebar';

    sidebar.innerHTML = `
      <div class="jh-sidebar-header">
        <div class="jh-sidebar-logo">
          <span class="jh-logo-icon">🎯</span>
          <span class="jh-logo-text">JobHunter</span>
        </div>
        <button class="jh-sidebar-collapse" id="jh-collapse" title="Hide sidebar">◀</button>
      </div>

      <div class="jh-sidebar-content" id="jh-sidebar-content">
        <!-- Job Info Section -->
        <div class="jh-section">
          <div class="jh-section-title">Detected Job</div>
          <div class="jh-job-card" id="jh-job-card">
            <div class="jh-job-title" id="jh-job-title">Scanning page...</div>
            <div class="jh-job-company" id="jh-job-company"></div>
            <div class="jh-job-meta">
              <span class="jh-job-location" id="jh-job-location"></span>
              <span class="jh-job-platform" id="jh-job-platform"></span>
            </div>
          </div>
          <button class="jh-btn jh-btn-sm jh-btn-ghost" id="jh-rescan">↻ Re-scan page</button>
        </div>

        <!-- Resume Section -->
        <div class="jh-section">
          <div class="jh-section-title">Resume</div>
          <div class="jh-field">
            <label class="jh-label">Job Type</label>
            <select class="jh-select" id="jh-jobtype">
              <option value="cloud">☁️ Cloud & Infra</option>
              <option value="it-mgmt">💼 IT Management</option>
              <option value="executive">🏆 Executive</option>
              <option value="staffing">🏢 Staffing</option>
            </select>
          </div>
          <div class="jh-field">
            <label class="jh-label">Resume File</label>
            <div class="jh-resume-file" id="jh-resume-file">
              <span class="jh-resume-filename" id="jh-resume-filename">No file linked</span>
            </div>
          </div>
        </div>

        <!-- Actions Section -->
        <div class="jh-section">
          <div class="jh-section-title">Actions</div>
          <div class="jh-actions">
            <button class="jh-btn jh-btn-primary jh-btn-full" id="jh-autofill">
              ⚡ Auto-Fill Application
            </button>
            <button class="jh-btn jh-btn-accent jh-btn-full" id="jh-save-job">
              📌 Save Job
            </button>
            <button class="jh-btn jh-btn-ghost jh-btn-full" id="jh-save-applied">
              📤 Mark as Applied
            </button>
          </div>
        </div>

        <!-- Auto-fill Status -->
        <div class="jh-section jh-hidden" id="jh-fill-status-section">
          <div class="jh-section-title">Auto-Fill Progress</div>
          <div class="jh-fill-log" id="jh-fill-log"></div>
        </div>
      </div>

      <div class="jh-sidebar-footer">
        <a class="jh-footer-link" id="jh-open-dashboard">📊 Dashboard</a>
        <a class="jh-footer-link" id="jh-open-settings">⚙️ Settings</a>
      </div>
    `;

    document.body.appendChild(sidebar);
    return sidebar;
  }

  // ── Toggle tab (collapsed/expanded) ────────────────────────────────────────
  function createToggleTab() {
    const tab = document.createElement('button');
    tab.id        = 'jh-toggle-tab';
    tab.className = 'jh-toggle-tab jh-hidden';
    tab.innerHTML = '🎯';
    tab.title     = 'Show JobHunter';
    document.body.appendChild(tab);
    return tab;
  }

  // ── Auto-fill engine ───────────────────────────────────────────────────────
  function logFill(log, msg, type = 'info') {
    const line = document.createElement('div');
    line.className = `jh-fill-line jh-fill-${type}`;
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function tryFillInput(selectors, value, label, log) {
    if (!value) return false;
    for (const sel of selectors) {
      const inputs = document.querySelectorAll(sel);
      for (const input of inputs) {
        if (input.offsetParent === null) continue; // hidden
        if (input.value && input.value.trim()) continue; // already filled
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
        logFill(log, `✓ ${label}`, 'success');
        return true;
      }
    }
    return false;
  }

  function tryFillSelect(selectors, matchText, label, log) {
    if (!matchText) return false;
    const lower = matchText.toLowerCase();
    for (const sel of selectors) {
      const selects = document.querySelectorAll(sel);
      for (const select of selects) {
        if (select.offsetParent === null) continue;
        for (const opt of select.options) {
          if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            logFill(log, `✓ ${label}: ${opt.text}`, 'success');
            return true;
          }
        }
      }
    }
    return false;
  }

  async function uploadResume(resumeFile, log) {
    if (!resumeFile || !resumeFile.data) {
      logFill(log, '⚠ No resume file linked for this type', 'warn');
      return false;
    }

    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) {
      logFill(log, '⚠ No file upload field found on page', 'warn');
      return false;
    }

    // Convert base64 to File object
    const byteString = atob(resumeFile.data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: 'application/pdf' });
    const file = new File([blob], resumeFile.name, { type: 'application/pdf' });

    // Try each file input (pick the first visible one, or first that accepts PDF)
    for (const input of fileInputs) {
      if (input.offsetParent === null && fileInputs.length > 1) continue;
      const accept = (input.accept || '').toLowerCase();
      if (accept && !accept.includes('pdf') && !accept.includes('*')) continue;

      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      logFill(log, `✓ Resume uploaded: ${resumeFile.name}`, 'success');
      return true;
    }

    logFill(log, '⚠ Could not attach resume to file input', 'warn');
    return false;
  }

  async function runAutoFill(resumeType) {
    const section = document.getElementById('jh-fill-status-section');
    const log     = document.getElementById('jh-fill-log');
    section.classList.remove('jh-hidden');
    log.innerHTML = '';
    logFill(log, 'Starting auto-fill...', 'info');

    // Get all data from background
    const data = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'GET_AUTOFILL_DATA', resumeType },
        resolve
      );
    });

    const p  = data.profile || {};
    const qa = data.qa || {};

    // 1. Upload resume
    logFill(log, 'Looking for resume upload field...', 'info');
    await uploadResume(data.resumeFile, log);

    // 2. Fill profile fields
    logFill(log, 'Filling profile fields...', 'info');

    // Name fields — try full name, then first/last separately
    const nameParts = (p.name || '').split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName  = nameParts.slice(1).join(' ') || '';

    tryFillInput(
      ['input[name*="first" i][name*="name" i]', 'input[autocomplete="given-name"]',
       'input[id*="first" i][id*="name" i]', 'input[placeholder*="First" i]'],
      firstName, 'First name', log
    );
    tryFillInput(
      ['input[name*="last" i][name*="name" i]', 'input[autocomplete="family-name"]',
       'input[id*="last" i][id*="name" i]', 'input[placeholder*="Last" i]'],
      lastName, 'Last name', log
    );
    tryFillInput(
      ['input[name*="full" i][name*="name" i]', 'input[autocomplete="name"]',
       'input[id*="fullName" i]', 'input[placeholder*="Full name" i]'],
      p.name, 'Full name', log
    );

    // Email
    tryFillInput(
      ['input[type="email"]', 'input[name*="email" i]', 'input[autocomplete="email"]',
       'input[id*="email" i]', 'input[placeholder*="email" i]'],
      p.email, 'Email', log
    );

    // Phone
    tryFillInput(
      ['input[type="tel"]', 'input[name*="phone" i]', 'input[autocomplete="tel"]',
       'input[id*="phone" i]', 'input[placeholder*="phone" i]'],
      p.phone, 'Phone', log
    );

    // Location / City
    tryFillInput(
      ['input[name*="city" i]', 'input[name*="location" i]',
       'input[id*="city" i]', 'input[id*="location" i]',
       'input[placeholder*="City" i]', 'input[placeholder*="Location" i]'],
      p.location, 'Location', log
    );

    // LinkedIn URL
    tryFillInput(
      ['input[name*="linkedin" i]', 'input[id*="linkedin" i]',
       'input[placeholder*="linkedin" i]', 'input[placeholder*="LinkedIn" i]'],
      p.linkedin || qa.linkedinUrl, 'LinkedIn URL', log
    );

    // Website / Portfolio
    tryFillInput(
      ['input[name*="website" i]', 'input[name*="portfolio" i]',
       'input[id*="website" i]', 'input[placeholder*="website" i]'],
      qa.websiteUrl, 'Website', log
    );

    // 3. Fill common Q&A fields
    logFill(log, 'Filling common questions...', 'info');

    // Work authorization
    tryFillSelect(
      ['select[name*="auth" i]', 'select[id*="auth" i]', 'select[name*="eligible" i]'],
      qa.workAuthorization, 'Work authorization', log
    );

    // Sponsorship
    tryFillSelect(
      ['select[name*="sponsor" i]', 'select[id*="sponsor" i]'],
      qa.sponsorship, 'Sponsorship', log
    );
    tryFillInput(
      ['input[name*="sponsor" i]'],
      qa.sponsorship, 'Sponsorship', log
    );

    // Salary
    tryFillInput(
      ['input[name*="salary" i]', 'input[id*="salary" i]', 'input[name*="compensation" i]',
       'input[placeholder*="salary" i]', 'input[placeholder*="Salary" i]'],
      qa.desiredSalary, 'Desired salary', log
    );

    // Years of experience
    tryFillInput(
      ['input[name*="experience" i]', 'input[id*="experience" i]',
       'input[name*="years" i]', 'input[placeholder*="years" i]'],
      qa.yearsExperience, 'Years of experience', log
    );

    // Education
    tryFillInput(
      ['input[name*="university" i]', 'input[name*="school" i]',
       'input[id*="university" i]', 'input[placeholder*="University" i]'],
      qa.university, 'University', log
    );

    tryFillSelect(
      ['select[name*="education" i]', 'select[name*="degree" i]',
       'select[id*="education" i]', 'select[id*="degree" i]'],
      qa.educationLevel, 'Education level', log
    );

    // EEO / voluntary self-identification
    tryFillSelect(
      ['select[name*="gender" i]', 'select[id*="gender" i]'],
      qa.gender, 'Gender', log
    );
    tryFillSelect(
      ['select[name*="veteran" i]', 'select[id*="veteran" i]'],
      qa.veteranStatus, 'Veteran status', log
    );
    tryFillSelect(
      ['select[name*="disability" i]', 'select[id*="disability" i]'],
      qa.disabilityStatus, 'Disability status', log
    );
    tryFillSelect(
      ['select[name*="ethnicity" i]', 'select[name*="race" i]',
       'select[id*="ethnicity" i]', 'select[id*="race" i]'],
      qa.ethnicity, 'Ethnicity', log
    );

    logFill(log, 'Auto-fill complete!', 'success');
  }

  // ── Main init ──────────────────────────────────────────────────────────────
  let sidebarVisible = true;

  function init() {
    if (document.getElementById('jh-sidebar')) return;

    const sidebar   = createSidebar();
    const toggleTab = createToggleTab();

    let resumeNames = {};
    let resumeFilesInfo = {};
    let currentJobType = 'it-mgmt';
    let currentJob = null;

    // Load resume file info
    chrome.runtime.sendMessage({ type: 'GET_RESUME_FILES_INFO' }, info => {
      resumeFilesInfo = info || {};
      updateResumeFileDisplay();
    });

    // Collapse / expand sidebar
    function collapseSidebar() {
      sidebar.classList.add('jh-collapsed');
      toggleTab.classList.remove('jh-hidden');
      sidebarVisible = false;
      document.body.style.marginRight = '0px';
    }
    function expandSidebar() {
      sidebar.classList.remove('jh-collapsed');
      toggleTab.classList.add('jh-hidden');
      sidebarVisible = true;
      document.body.style.marginRight = '340px';
    }

    document.getElementById('jh-collapse').addEventListener('click', collapseSidebar);
    toggleTab.addEventListener('click', expandSidebar);

    // Listen for toggle from popup or keyboard shortcut
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOGGLE_SIDEBAR') {
        if (sidebarVisible) collapseSidebar();
        else expandSidebar();
      }
    });

    // Scan page and populate job info
    function scanPage() {
      currentJob = extractJobInfo();
      document.getElementById('jh-job-title').textContent   = currentJob.title   || '(no title detected)';
      document.getElementById('jh-job-company').textContent  = currentJob.company || '(no company detected)';
      document.getElementById('jh-job-location').textContent = currentJob.location || '';
      document.getElementById('jh-job-platform').textContent = currentJob.platform || '';

      // Auto-detect job type
      chrome.runtime.sendMessage(
        { type: 'SUGGEST_RESUME', title: currentJob.title, company: currentJob.company },
        resp => {
          if (!resp) return;
          resumeNames    = resp.resumeNames || {};
          currentJobType = resp.jobType     || 'it-mgmt';
          document.getElementById('jh-jobtype').value = currentJobType;
          updateResumeFileDisplay();
        }
      );
    }

    function updateResumeFileDisplay() {
      const type = document.getElementById('jh-jobtype')?.value || currentJobType;
      const info = resumeFilesInfo[type];
      const el   = document.getElementById('jh-resume-filename');
      if (info) {
        el.textContent = `📄 ${info.name}`;
        el.classList.remove('jh-no-file');
      } else {
        el.textContent = '⚠ No file linked — upload in Settings';
        el.classList.add('jh-no-file');
      }
    }

    // Job type change
    document.getElementById('jh-jobtype').addEventListener('change', e => {
      currentJobType = e.target.value;
      updateResumeFileDisplay();
    });

    // Re-scan
    document.getElementById('jh-rescan').addEventListener('click', scanPage);

    // Save job
    document.getElementById('jh-save-job').addEventListener('click', () => {
      if (!currentJob) return;
      const jobType    = document.getElementById('jh-jobtype').value;
      const resumeUsed = resumeNames[jobType] || '';

      chrome.runtime.sendMessage(
        { type: 'SAVE_JOB', job: { ...currentJob, jobType, resumeUsed, status: 'saved' } },
        resp => {
          if (resp?.ok) showToast('📌 Job saved!');
          else if (resp?.reason === 'duplicate') showToast('Already saved', 'warn');
          else showToast('Save failed', 'error');
        }
      );
    });

    // Mark as applied
    document.getElementById('jh-save-applied').addEventListener('click', () => {
      if (!currentJob) return;
      const jobType    = document.getElementById('jh-jobtype').value;
      const resumeUsed = resumeNames[jobType] || '';

      chrome.runtime.sendMessage(
        { type: 'SAVE_JOB', job: { ...currentJob, jobType, resumeUsed, status: 'applied' } },
        resp => {
          if (resp?.ok) showToast('📤 Marked as applied!');
          else if (resp?.reason === 'duplicate') showToast('Already saved', 'warn');
          else showToast('Save failed', 'error');
        }
      );
    });

    // Auto-fill
    document.getElementById('jh-autofill').addEventListener('click', () => {
      const jobType = document.getElementById('jh-jobtype').value;
      runAutoFill(jobType);
    });

    // Footer links
    document.getElementById('jh-open-dashboard').addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    });
    document.getElementById('jh-open-settings').addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
    });

    // Initial scan
    setTimeout(scanPage, 500);

    // Push main content to the left to make room
    expandSidebar();

    // Check saved preference
    chrome.storage.local.get(['sidebarCollapsed'], r => {
      if (r.sidebarCollapsed) collapseSidebar();
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init on SPA navigation
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        // Just re-scan, don't rebuild the sidebar
        const sidebar = document.getElementById('jh-sidebar');
        if (sidebar) {
          const titleEl = document.getElementById('jh-job-title');
          if (titleEl) titleEl.textContent = 'Scanning page...';
          setTimeout(() => {
            const job = extractJobInfo();
            document.getElementById('jh-job-title').textContent   = job.title   || '(no title detected)';
            document.getElementById('jh-job-company').textContent  = job.company || '(no company detected)';
            document.getElementById('jh-job-location').textContent = job.location || '';
            document.getElementById('jh-job-platform').textContent = job.platform || '';

            chrome.runtime.sendMessage(
              { type: 'SUGGEST_RESUME', title: job.title, company: job.company },
              resp => {
                if (!resp) return;
                document.getElementById('jh-jobtype').value = resp.jobType || 'it-mgmt';
              }
            );
          }, 800);
        } else {
          init();
        }
      }, 300);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
