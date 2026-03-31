// JobHunter — Content Script
// Injects the 🎯 save button and confirm panel onto job listing pages
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const JOB_TYPE_LABELS = {
    'cloud':     '☁️ Cloud & Infrastructure',
    'it-mgmt':   '💼 IT Management',
    'executive': '🏆 Executive',
    'staffing':  '🏢 Staffing / Contract',
  };

  // ── Extract job info from the current page ─────────────────────────────────
  function extractJobInfo() {
    const url      = location.href;
    const hostname = location.hostname.replace(/^www\./, '');

    // Title — try structured data first, then h1, then page title
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

    // Company — meta, structured data, common selectors
    let company = '';
    company = document.querySelector('meta[property="og:site_name"]')?.content || '';
    if (!company) {
      const selectors = [
        '[data-company]','[class*="company-name"]','[class*="CompanyName"]',
        '[class*="employer"]','[itemprop="hiringOrganization"]',
        '.jobs-unified-top-card__company-name',   // LinkedIn
        '[data-testid="inlineHeader-companyName"]', // Indeed
        '.company-name',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el?.innerText?.trim()) { company = el.innerText.trim(); break; }
      }
    }

    // Location
    let location = '';
    const locSelectors = [
      '[class*="location"]','[class*="Location"]',
      '[data-testid="job-location"]',
      '.jobs-unified-top-card__bullet',
    ];
    for (const s of locSelectors) {
      const el = document.querySelector(s);
      if (el?.innerText?.trim()) { location = el.innerText.trim(); break; }
    }

    // Platform — infer from hostname
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
    else if (hostname.includes('ziprecruiter')) platform = 'ZipRecruiter';
    else if (hostname.includes('dice'))        platform = 'Dice';
    else if (hostname.includes('monster'))     platform = 'Monster';

    return { title, company, location, platform, url };
  }

  // ── Build the floating save button ────────────────────────────────────────
  function createSaveButton() {
    const btn = document.createElement('button');
    btn.id        = 'jh-save-btn';
    btn.className = 'jh-save-btn';
    btn.innerHTML = '🎯';
    btn.title     = 'Save job to JobHunter';
    document.body.appendChild(btn);
    return btn;
  }

  // ── Build the confirm panel ────────────────────────────────────────────────
  function createConfirmPanel() {
    const panel = document.createElement('div');
    panel.id        = 'jh-confirm-panel';
    panel.className = 'jh-confirm-panel jh-hidden';
    panel.innerHTML = `
      <div class="jh-panel-header">
        <span class="jh-panel-logo">🎯</span>
        <span class="jh-panel-title">Save to JobHunter</span>
        <button class="jh-panel-close" id="jh-panel-close">✕</button>
      </div>
      <div class="jh-panel-body">
        <div class="jh-field-group">
          <div class="jh-job-preview">
            <div class="jh-job-title-preview" id="jh-title-preview">—</div>
            <div class="jh-job-co-preview"    id="jh-co-preview">—</div>
          </div>
        </div>
        <div class="jh-field-group">
          <label class="jh-label">Job Type</label>
          <select class="jh-select" id="jh-jobtype-select">
            <option value="cloud">☁️ Cloud &amp; Infrastructure</option>
            <option value="it-mgmt">💼 IT Management</option>
            <option value="executive">🏆 Executive</option>
            <option value="staffing">🏢 Staffing / Contract</option>
          </select>
        </div>
        <div class="jh-field-group">
          <label class="jh-label">Resume to Use</label>
          <select class="jh-select" id="jh-resume-select">
            <option value="">Loading…</option>
          </select>
        </div>
        <div class="jh-field-group">
          <label class="jh-label">Status</label>
          <select class="jh-select" id="jh-status-select">
            <option value="saved">📌 Saved</option>
            <option value="applied">📤 Applied</option>
          </select>
        </div>
      </div>
      <div class="jh-panel-footer">
        <button class="jh-btn jh-btn-secondary" id="jh-panel-cancel">Cancel</button>
        <button class="jh-btn jh-btn-primary"   id="jh-panel-save">💾 Save Job</button>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
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

  // ── Main init ──────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('jh-save-btn')) return; // already injected

    const saveBtn = createSaveButton();
    const panel   = createConfirmPanel();

    let resumeNames = {};
    let currentJobType = 'it-mgmt';

    // Populate resume dropdown when job type changes
    function updateResumeDropdown(jobType) {
      const sel = document.getElementById('jh-resume-select');
      if (!sel) return;
      sel.innerHTML = '';
      Object.entries(resumeNames).forEach(([type, name]) => {
        const opt      = document.createElement('option');
        opt.value      = type;
        opt.textContent = name;
        if (type === jobType) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    // Open panel on button click
    saveBtn.addEventListener('click', async () => {
      const job = extractJobInfo();

      // Fill in preview
      document.getElementById('jh-title-preview').textContent = job.title   || '(no title detected)';
      document.getElementById('jh-co-preview').textContent    = job.company || '(no company detected)';

      // Ask background for suggestion
      chrome.runtime.sendMessage(
        { type: 'SUGGEST_RESUME', title: job.title, company: job.company },
        resp => {
          resumeNames    = resp.resumeNames || {};
          currentJobType = resp.jobType     || 'it-mgmt';

          // Set job type dropdown
          const jtSel = document.getElementById('jh-jobtype-select');
          if (jtSel) jtSel.value = currentJobType;

          updateResumeDropdown(currentJobType);
        }
      );

      panel.classList.remove('jh-hidden');
      saveBtn.classList.add('jh-hidden');
    });

    // Job type change → update resume suggestion
    document.addEventListener('change', e => {
      if (e.target.id === 'jh-jobtype-select') {
        currentJobType = e.target.value;
        updateResumeDropdown(currentJobType);
      }
    });

    // Close / cancel
    function closePanel() {
      panel.classList.add('jh-hidden');
      saveBtn.classList.remove('jh-hidden');
    }
    document.getElementById('jh-panel-close').addEventListener('click',  closePanel);
    document.getElementById('jh-panel-cancel').addEventListener('click', closePanel);

    // Save
    document.getElementById('jh-panel-save').addEventListener('click', () => {
      const job        = extractJobInfo();
      const jobType    = document.getElementById('jh-jobtype-select')?.value  || currentJobType;
      const resumeType = document.getElementById('jh-resume-select')?.value   || jobType;
      const status     = document.getElementById('jh-status-select')?.value   || 'saved';
      const resumeUsed = resumeNames[resumeType] || resumeNames[jobType] || '';

      const saveBtn2 = document.getElementById('jh-panel-save');
      saveBtn2.disabled     = true;
      saveBtn2.textContent  = 'Saving…';

      chrome.runtime.sendMessage(
        { type: 'SAVE_JOB', job: { ...job, jobType, resumeUsed, status } },
        resp => {
          if (resp?.ok) {
            showToast(`✅ Saved! Resume: ${resumeUsed}`);
          } else if (resp?.reason === 'duplicate') {
            showToast('Already saved!', 'warn');
          } else {
            showToast('Save failed — try again', 'error');
          }
          closePanel();
          saveBtn2.disabled    = false;
          saveBtn2.textContent = '💾 Save Job';
        }
      );
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init on SPA navigation (LinkedIn, Indeed use pushState)
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const old = document.getElementById('jh-save-btn');
        if (old) old.remove();
        const oldP = document.getElementById('jh-confirm-panel');
        if (oldP) oldP.remove();
        init();
      }, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
