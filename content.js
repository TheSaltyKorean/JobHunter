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

  // ── Smart Form Scanner ────────────────────────────────────────────────────
  // Walks the DOM and finds every fillable field along with its "question" label
  function extractFieldLabel(el) {
    // 1. Explicit <label for="...">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.innerText?.trim()) return label.innerText.trim();
    }
    // 2. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel?.innerText?.trim()) return parentLabel.innerText.trim();
    // 3. aria-label / aria-labelledby
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText).filter(Boolean);
      if (parts.length) return parts.join(' ').trim();
    }
    // 4. placeholder
    if (el.placeholder) return el.placeholder.trim();
    // 5. name/id as fallback (split camelCase / snake_case)
    const raw = el.name || el.id || '';
    if (raw) return raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]/g, ' ').trim();
    // 6. Walk backwards through preceding siblings for text
    let node = el.previousElementSibling || el.parentElement?.previousElementSibling;
    for (let i = 0; i < 3 && node; i++) {
      const text = node.innerText?.trim();
      if (text && text.length < 200) return text;
      node = node.previousElementSibling;
    }
    return '';
  }

  function scanFormFields() {
    const fields = [];
    // Inputs (text, email, tel, number, url, date, etc.)
    const textInputTypes = new Set(['text', 'email', 'tel', 'number', 'url', 'date', 'month', 'search', '']);
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.closest('#jh-sidebar')) return; // Skip our own UI
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'image') return;
      if (el.type === 'file') return; // Handle file inputs separately
      if (el.offsetParent === null && el.type !== 'radio' && el.type !== 'checkbox') return; // hidden
      if (el.readOnly || el.disabled) return;

      const label = extractFieldLabel(el);
      const tag   = el.tagName.toLowerCase();
      let fieldType = 'input';
      if (tag === 'select') fieldType = 'select';
      else if (tag === 'textarea') fieldType = 'textarea';
      else if (el.type === 'radio') fieldType = 'radio';
      else if (el.type === 'checkbox') fieldType = 'checkbox';

      fields.push({ element: el, label, fieldType, filled: !!(el.value?.trim()) });
    });
    return fields;
  }

  // ── Fill a single field with a value ──────────────────────────────────────
  function fillField(field, value) {
    const el = field.element;
    if (!value) return false;

    if (field.fieldType === 'select') {
      return fillSelect(el, value);
    }
    if (field.fieldType === 'radio') {
      return fillRadio(el, value);
    }
    if (field.fieldType === 'checkbox') {
      return fillCheckbox(el, value);
    }
    // text input or textarea
    if (el.value && el.value.trim()) return false; // already filled
    el.focus();
    // Use native setter to work with React controlled inputs
    const nativeSet = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSet) nativeSet.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.blur();
    return true;
  }

  function fillSelect(el, matchText) {
    const lower = matchText.toLowerCase();
    // Try exact match first, then partial
    let best = null;
    let bestScore = 0;
    for (const opt of el.options) {
      if (opt.disabled || !opt.value) continue;
      const optText = opt.text.toLowerCase();
      const optVal  = opt.value.toLowerCase();
      if (optText === lower || optVal === lower) { best = opt; bestScore = 1000; break; }
      // Partial match
      const words = lower.split(/\s+/);
      let score = 0;
      for (const w of words) {
        if (optText.includes(w)) score += w.length;
        if (optVal.includes(w)) score += w.length;
      }
      // Also check if option text is contained in our answer
      if (lower.includes(optText) && optText.length > 1) score += optText.length * 2;
      if (score > bestScore) { bestScore = score; best = opt; }
    }
    if (best && bestScore > 1) {
      el.value = best.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function fillRadio(el, value) {
    // Find all radios in the same group
    const name = el.name;
    if (!name) return false;
    const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
    const lower = value.toLowerCase();
    for (const radio of radios) {
      const label = extractFieldLabel(radio).toLowerCase();
      const val   = radio.value.toLowerCase();
      if (label.includes(lower) || val.includes(lower) || lower.includes(label) || lower.includes(val)) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function fillCheckbox(el, value) {
    const lower = value.toLowerCase();
    const shouldCheck = ['yes', 'true', '1', 'agree', 'accept', 'i agree'].some(v => lower.includes(v));
    if (shouldCheck && !el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  // ── Resume upload ─────────────────────────────────────────────────────────
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

    for (const input of fileInputs) {
      if (input.offsetParent === null && fileInputs.length > 1) continue;
      const accept = (input.accept || '').toLowerCase();
      if (accept && !accept.includes('pdf') && !accept.includes('*') && !accept.includes('.pdf')) continue;

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

  // ── Resolve a matched key to an actual value ──────────────────────────────
  function resolveValue(key, profile, qa) {
    // Special profile keys (prefixed with _)
    const nameParts = (profile.name || '').split(/\s+/);
    const map = {
      '_firstName':  nameParts[0] || '',
      '_lastName':   nameParts.slice(1).join(' ') || '',
      '_fullName':   profile.name || '',
      '_email':      profile.email || '',
      '_phone':      profile.phone || '',
      '_location':   profile.location || '',
    };
    if (key in map) return map[key];
    // Q&A key
    if (key in qa) return qa[key] || '';
    // LinkedIn from profile as fallback
    if (key === 'linkedinUrl') return qa.linkedinUrl || profile.linkedin || '';
    return '';
  }

  // ── Main auto-fill ────────────────────────────────────────────────────────
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

    const profile  = data.profile  || {};
    const qa       = data.qa       || {};
    const customQA = data.customQA || [];

    // 1. Upload resume
    logFill(log, 'Looking for resume upload field...', 'info');
    await uploadResume(data.resumeFile, log);

    // 2. Scan all form fields
    logFill(log, 'Scanning form fields...', 'info');
    const fields = scanFormFields();
    logFill(log, `Found ${fields.length} fillable fields`, 'info');

    // Track what we've already filled (by radio group name, etc.)
    const filledGroups = new Set();
    const unknownFields = [];
    let filled = 0;
    let skipped = 0;

    for (const field of fields) {
      if (field.filled) { skipped++; continue; }
      if (field.fieldType === 'radio' && filledGroups.has(field.element.name)) continue;

      const label = field.label;

      // A. Check custom Q&A first (user-defined exact/fuzzy matches)
      let matchedCustom = false;
      for (const pair of customQA) {
        if (!pair.question || !pair.answer) continue;
        const q = pair.question.toLowerCase();
        const l = label.toLowerCase();
        // Check if custom question matches the field label
        if (l.includes(q) || q.includes(l) || fuzzyScore(l, q) > 0.6) {
          if (fillField(field, pair.answer)) {
            logFill(log, `✓ ${label} (custom Q&A)`, 'success');
            filled++;
            matchedCustom = true;
            if (field.fieldType === 'radio') filledGroups.add(field.element.name);
            break;
          }
        }
      }
      if (matchedCustom) continue;

      // B. Fuzzy match against built-in rules (via background)
      const match = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'MATCH_QUESTION', question: label }, resolve);
      });

      if (match) {
        const value = resolveValue(match.key, profile, qa);
        if (value) {
          if (fillField(field, value)) {
            logFill(log, `✓ ${label}`, 'success');
            filled++;
            if (field.fieldType === 'radio') filledGroups.add(field.element.name);
            continue;
          }
        }
      }

      // C. Track as unknown for Claude API pass
      if (label && label.length > 2) {
        unknownFields.push(field);
      }
    }

    // 3. Claude API pass for unknown fields
    if (unknownFields.length > 0 && data.hasClaudeKey) {
      logFill(log, `Asking Claude about ${unknownFields.length} unrecognized fields...`, 'info');
      for (const field of unknownFields) {
        try {
          const resp = await new Promise(resolve => {
            chrome.runtime.sendMessage(
              { type: 'ASK_CLAUDE', question: field.label },
              resolve
            );
          });
          if (resp?.answer) {
            if (fillField(field, resp.answer)) {
              logFill(log, `✓ ${field.label} (Claude)`, 'success');
              filled++;
              if (field.fieldType === 'radio') filledGroups.add(field.element.name);
            } else {
              logFill(log, `⚠ ${field.label} — Claude suggested "${resp.answer}" but couldn't fill`, 'warn');
            }
          } else {
            logFill(log, `⚠ ${field.label} — skipped`, 'warn');
          }
        } catch (e) {
          logFill(log, `⚠ ${field.label} — Claude error`, 'warn');
        }
      }
    } else if (unknownFields.length > 0) {
      for (const field of unknownFields) {
        logFill(log, `⚠ ${field.label} — no match (add Claude API key for smart fill)`, 'warn');
      }
    }

    logFill(log, `Auto-fill complete! Filled ${filled}, skipped ${skipped} pre-filled.`, 'success');
  }

  // ── Simple fuzzy score (Jaccard similarity on character bigrams) ──────────
  function fuzzyScore(a, b) {
    if (!a || !b) return 0;
    const bigrams = (s) => {
      const set = new Set();
      const lower = s.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (let i = 0; i < lower.length - 1; i++) set.add(lower.slice(i, i + 2));
      return set;
    };
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const bg of setA) { if (setB.has(bg)) intersection++; }
    return intersection / (setA.size + setB.size - intersection);
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
