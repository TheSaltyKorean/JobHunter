// JobHunter — Content Script (Sidebar Mode)
// Injects a collapsible sidebar panel on job listing pages
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  console.log('JobHunter: content script loaded on', location.href);

  // Skip chrome:// and extension pages
  if (location.protocol === 'chrome:' || location.protocol === 'chrome-extension:') return;

  // Dynamic job types — loaded from background, with hardcoded fallback
  let JOB_TYPE_LABELS = {
    'cloud':     '☁️ Cloud & Infra',
    'it-mgmt':   '💼 IT Mgmt',
    'executive': '🏆 Executive',
    'staffing':  '🏢 Staffing',
  };
  let JOB_TYPE_KEYS = ['cloud', 'it-mgmt', 'executive', 'staffing'];

  // Load dynamic job types from background
  function loadJobTypes() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'SUGGEST_RESUME', title: '', company: '' }, resp => {
        if (resp?.jobTypes && resp.jobTypes.length) {
          JOB_TYPE_LABELS = {};
          JOB_TYPE_KEYS = [];
          resp.jobTypes.forEach(jt => {
            JOB_TYPE_LABELS[jt.key] = `${jt.emoji} ${jt.label}`;
            JOB_TYPE_KEYS.push(jt.key);
          });
        }
        resolve();
      });
    });
  }

  // ── Extract job info from the current page ─────────────────────────────────

  // Shared: try to find a company name from common DOM patterns
  function findCompanyInDOM() {
    // 1. Specific selectors (class-based, data attributes, itemprop)
    const selectors = [
      '[itemprop="hiringOrganization"] [itemprop="name"]',
      '[itemprop="hiringOrganization"]',
      '[data-company]', '[data-company-name]', '[data-testid="company-name"]',
      '[data-testid="inlineHeader-companyName"]',
      '[class*="company-name"]', '[class*="CompanyName"]', '[class*="companyName"]',
      '[class*="employer-name"]', '[class*="EmployerName"]',
      '.company-name', '.employer-name',
      '.jobs-unified-top-card__company-name',
    ];
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        const text = el?.innerText?.trim();
        if (text && text.length < 80) return text;
      } catch (_) {}
    }

    // 2. og:title sometimes has "Job Title at Company" or "Job Title - Company"
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const atMatch = ogTitle.match(/\bat\s+(.+?)(?:\s*[-|]|$)/i);
    if (atMatch && atMatch[1].trim().length > 1) return atMatch[1].trim();

    // 3. LD+JSON
    const ldJson = document.querySelector('script[type="application/ld+json"]');
    if (ldJson) {
      try {
        const d = JSON.parse(ldJson.textContent);
        const org = d.hiringOrganization || d.employer;
        if (org?.name) return org.name;
      } catch (_) {}
    }

    // 4. Page header area: look for logo-adjacent text in the top 200px
    const headerEls = document.querySelectorAll('header a, nav a, [class*="logo"] + *, [class*="brand"]');
    for (const el of headerEls) {
      const text = el.innerText?.trim();
      // Skip if it looks like a nav item
      if (text && text.length > 2 && text.length < 50 && !/home|jobs|career|sign|log|menu/i.test(text)) {
        return text;
      }
    }

    // 5. og:site_name — only if it doesn't match a known platform
    const ogSite = document.querySelector('meta[property="og:site_name"]')?.content || '';
    const platformNames = ['indeed','glassdoor','ziprecruiter','dice','monster','greenhouse',
      'lever','workday','linkedin','icims','taleo','smartrecruiters','jobvite'];
    if (ogSite && !platformNames.some(p => ogSite.toLowerCase().includes(p))) {
      return ogSite;
    }

    return '';
  }

  // Shared: find location from common patterns
  function findLocationInDOM() {
    const locSelectors = [
      '[itemprop="jobLocation"] [itemprop="address"]',
      '[itemprop="jobLocation"]',
      '[class*="location"]', '[class*="Location"]',
      '[data-testid="job-location"]',
      '.jobs-unified-top-card__bullet',
    ];
    for (const s of locSelectors) {
      try {
        const el = document.querySelector(s);
        const text = el?.innerText?.trim();
        if (text && text.length < 100) return text;
      } catch (_) {}
    }
    return '';
  }

  // LinkedIn obfuscates all class names, so DOM selectors are unreliable.
  // Most reliable source: document.title = "Job Title | Company | LinkedIn"
  function extractLinkedInJob() {
    const url = location.href;
    const titleParts = document.title.split('|').map(p => p.trim());
    let title = '';
    let company = '';

    if (titleParts.length >= 3 && titleParts[titleParts.length - 1] === 'LinkedIn') {
      // "Job Title | Company Name | LinkedIn"
      title   = titleParts.slice(0, -2).join(' | ').trim();
      company = titleParts[titleParts.length - 2].trim();
    } else if (titleParts.length === 2) {
      title = titleParts[0];
    }

    // Skip generic page titles that aren't job listings
    const genericTitles = ['my jobs', 'jobs', 'job search', 'linkedin'];
    if (genericTitles.includes(title.toLowerCase())) {
      title = '';
      company = '';
    }

    // Location: walk text nodes looking for "City, ST" pattern
    let loc = '';
    const locWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const cityStateRx = /^[A-Z][a-zA-Z\s.]+,\s*[A-Z]{2}(?:\s*\(.*\))?$/;
    while (locWalker.nextNode()) {
      const t = locWalker.currentNode.textContent?.trim();
      if (t && cityStateRx.test(t) && t.length < 60) {
        const parent = locWalker.currentNode.parentElement;
        if (parent && parent.children.length === 0) {
          loc = t;
          break;
        }
      }
    }

    return { title, company, location: loc, platform: 'LinkedIn', url };
  }

  // Indeed: document.title = "Job Title - Company - City, ST | Indeed.com"
  function extractIndeedJob() {
    const url = location.href;
    const raw = document.title.replace(/\s*\|\s*Indeed\.com\s*$/i, '').trim();
    const parts = raw.split(/\s+-\s+/); // split on " - " (with spaces) to avoid splitting hyphenated titles
    let title = '', company = '', loc = '';
    if (parts.length >= 3) {
      title   = parts[0].trim();
      company = parts[1].trim();
      loc     = parts.slice(2).join(' - ').trim();
    } else if (parts.length === 2) {
      title   = parts[0].trim();
      company = parts[1].trim();
    } else {
      title = raw;
    }
    const domCompany = findCompanyInDOM();
    const domLoc     = findLocationInDOM();
    return {
      title:    title || document.querySelector('h1')?.innerText?.trim() || '',
      company:  company || domCompany,
      location: loc || domLoc,
      platform: 'Indeed',
      url,
    };
  }

  // Generic extractor for all other sites (careers pages, ATS, etc.)
  function extractGenericJob() {
    const url = location.href;

    // Title: LD+JSON > h1 > document.title (split on | only, NOT -)
    let title = '';
    const ldJson = document.querySelector('script[type="application/ld+json"]');
    if (ldJson) {
      try {
        const d = JSON.parse(ldJson.textContent);
        title = d.title || d.name || '';
      } catch (_) {}
    }
    if (!title) {
      const h1 = document.querySelector('h1');
      const h1Text = h1?.innerText?.trim();
      // Skip generic headings like "Start Your Application", "Sign In", "Apply Now"
      const genericH1 = ['start your application', 'sign in', 'apply now', 'apply', 'log in',
        'create account', 'register', 'careers', 'jobs', 'search'];
      if (h1Text && !genericH1.includes(h1Text.toLowerCase())) {
        title = h1Text;
      }
    }
    // If h1 was generic, check h2
    if (!title) {
      const h2s = document.querySelectorAll('h2');
      for (const h2 of h2s) {
        const text = h2.innerText?.trim();
        if (text && text.length > 5 && text.length < 100 && !/premium|alert|similar|recommend/i.test(text)) {
          title = text;
          break;
        }
      }
    }
    // Last resort: document.title split on pipe only
    if (!title) {
      const parts = document.title.split('|').map(p => p.trim());
      title = parts[0] || '';
    }

    const company = findCompanyInDOM();
    const loc     = findLocationInDOM();

    return { title, company, location: loc, url };
  }

  function extractJobInfo() {
    const hostname = location.hostname.replace(/^www\./, '');

    let platform = hostname;
    if (hostname.includes('linkedin'))           platform = 'LinkedIn';
    else if (hostname.includes('indeed'))        platform = 'Indeed';
    else if (hostname.includes('greenhouse'))    platform = 'Greenhouse';
    else if (hostname.includes('lever'))         platform = 'Lever';
    else if (hostname.includes('workday'))       platform = 'Workday';
    else if (hostname.includes('smartrecruiter')) platform = 'SmartRecruiters';
    else if (hostname.includes('jobvite'))       platform = 'Jobvite';
    else if (hostname.includes('icims'))         platform = 'iCIMS';
    else if (hostname.includes('taleo'))         platform = 'Taleo';
    else if (hostname.includes('career'))        platform = hostname.split('.').slice(-2, -1)[0] + ' Careers';

    // Use site-specific extractors where the DOM is unreliable
    if (hostname.includes('linkedin')) return extractLinkedInJob();
    if (hostname.includes('indeed'))   return extractIndeedJob();

    // Generic extractor for all other sites
    const info = extractGenericJob();
    info.platform = platform;
    return info;
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
            <select class="jh-select" id="jh-jobtype"></select>
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
    // 3b. data-automation-id (Workday) — humanize the automation ID
    const autoId = el.getAttribute('data-automation-id');
    if (autoId) {
      const humanized = autoId.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (humanized.length > 2) return humanized;
    }
    // 4. placeholder
    if (el.placeholder) return el.placeholder.trim();
    // 5. Walk up ancestors looking for a label-like sibling or parent text
    let parent = el.parentElement;
    for (let depth = 0; depth < 4 && parent; depth++) {
      // Check for a label child of the parent (sibling to our element's container)
      const sibLabel = parent.querySelector(':scope > label, :scope > legend, :scope > [class*="label"]');
      if (sibLabel && sibLabel !== el) {
        const text = sibLabel.innerText?.trim();
        if (text && text.length < 100) return text;
      }
      parent = parent.parentElement;
    }
    // 6. name/id as fallback (split camelCase / snake_case)
    const raw = el.name || el.id || '';
    if (raw) return raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]/g, ' ').trim();
    // 7. Walk backwards through preceding siblings for text
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

    // Workday & other ATS: custom listbox buttons (dropdowns that aren't <select>)
    document.querySelectorAll('button[aria-haspopup="listbox"]').forEach(btn => {
      if (btn.closest('#jh-sidebar')) return;
      if (btn.offsetParent === null) return;
      const label = extractFieldLabel(btn);
      fields.push({ element: btn, label, fieldType: 'workday-listbox', filled: false });
    });

    // Workday multi-select typeahead containers
    document.querySelectorAll('[data-uxi-widget-type="multiselect"]').forEach(container => {
      if (container.closest('#jh-sidebar')) return;
      if (container.offsetParent === null) return;
      const label = extractFieldLabel(container);
      const selected = container.querySelector('[data-automation-id="promptSelectionLabel"]');
      const hasSelections = selected && selected.textContent?.trim().length > 0;
      fields.push({ element: container, label, fieldType: 'workday-multiselect', filled: hasSelections });
    });

    return fields;
  }

  // ── Fill a single field with a value ──────────────────────────────────────
  async function fillField(field, value) {
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
    if (field.fieldType === 'workday-listbox') {
      return await fillWorkdayListbox(el, value);
    }
    if (field.fieldType === 'workday-multiselect') {
      return await fillWorkdayMultiselect(el, value);
    }
    // text input or textarea
    const existing = (el.value || '').trim();
    // Allow overwriting partial/error date values (e.g. "/2026", "Error: Invalid Date")
    if (existing && !/^\/|error|^mm|^dd|^yyyy/i.test(existing)) return false; // already filled
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

  // US state abbreviation ↔ full name mapping for dropdown matching
  const US_STATES = {
    'al':'alabama','ak':'alaska','az':'arizona','ar':'arkansas','ca':'california',
    'co':'colorado','ct':'connecticut','de':'delaware','fl':'florida','ga':'georgia',
    'hi':'hawaii','id':'idaho','il':'illinois','in':'indiana','ia':'iowa','ks':'kansas',
    'ky':'kentucky','la':'louisiana','me':'maine','md':'maryland','ma':'massachusetts',
    'mi':'michigan','mn':'minnesota','ms':'mississippi','mo':'missouri','mt':'montana',
    'ne':'nebraska','nv':'nevada','nh':'new hampshire','nj':'new jersey','nm':'new mexico',
    'ny':'new york','nc':'north carolina','nd':'north dakota','oh':'ohio','ok':'oklahoma',
    'or':'oregon','pa':'pennsylvania','ri':'rhode island','sc':'south carolina',
    'sd':'south dakota','tn':'tennessee','tx':'texas','ut':'utah','vt':'vermont',
    'va':'virginia','wa':'washington','wv':'west virginia','wi':'wisconsin','wy':'wyoming',
    'dc':'district of columbia',
  };
  // Reverse map: full name → abbreviation
  const US_STATES_REV = {};
  for (const [abbr, full] of Object.entries(US_STATES)) US_STATES_REV[full] = abbr;

  function fillSelect(el, matchText) {
    const lower = matchText.toLowerCase().trim();
    // Expand state abbreviation for matching (e.g. "FL" → also try "florida")
    const stateExpanded = US_STATES[lower] || '';
    const stateAbbr = US_STATES_REV[lower] || '';
    const variants = [lower];
    if (stateExpanded) variants.push(stateExpanded);
    if (stateAbbr) variants.push(stateAbbr);

    let best = null;
    let bestScore = 0;
    for (const opt of el.options) {
      if (opt.disabled || !opt.value) continue;
      const optText = opt.text.toLowerCase().trim();
      const optVal  = opt.value.toLowerCase().trim();

      // Try exact match against all variants
      for (const v of variants) {
        if (optText === v || optVal === v) { best = opt; bestScore = 1000; break; }
      }
      if (bestScore >= 1000) break;

      // State abbreviation in option value (common: value="FL", text="Florida")
      if (stateExpanded && (optText === stateExpanded || optVal === lower)) {
        best = opt; bestScore = 999; continue;
      }
      if (stateAbbr && (optVal === stateAbbr || optText === lower)) {
        best = opt; bestScore = 999; continue;
      }

      // Partial word match
      const words = lower.split(/\s+/);
      let score = 0;
      for (const w of words) {
        if (optText.includes(w)) score += w.length;
        if (optVal.includes(w)) score += w.length;
      }
      if (lower.includes(optText) && optText.length > 1) score += optText.length * 2;
      if (score > bestScore) { bestScore = score; best = opt; }
    }
    if (best && bestScore > 1) {
      el.value = best.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
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
    const shouldCheck = ['yes', 'true', '1', 'agree', 'accept', 'i agree', 'i consent'].some(v => lower.includes(v));
    if (shouldCheck && !el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
      return true;
    }
    return false;
  }

  // ── Fill Workday custom listbox (button[aria-haspopup="listbox"]) ──────────
  // Clicks the button to open the listbox, finds the matching option, clicks it
  function fillWorkdayListbox(btn, value) {
    const lower = value.toLowerCase().trim();
    // Click to open the dropdown listbox
    btn.click();
    // Wait a tick for the listbox to render, then find and click the option
    return new Promise(resolve => {
      setTimeout(() => {
        // Workday renders a [role="listbox"] with [role="option"] children
        const listboxes = document.querySelectorAll('[role="listbox"]');
        for (const listbox of listboxes) {
          const options = listbox.querySelectorAll('[role="option"]');
          let best = null;
          let bestScore = 0;
          for (const opt of options) {
            const text = (opt.textContent || '').trim().toLowerCase();
            if (text === lower) { best = opt; bestScore = 1000; break; }
            if (text.includes(lower) || lower.includes(text)) {
              const score = Math.min(text.length, lower.length) / Math.max(text.length, lower.length);
              if (score > bestScore) { best = opt; bestScore = score; }
            }
          }
          if (best && bestScore > 0.3) {
            best.click();
            resolve(true);
            return;
          }
        }
        // If no listbox found, try closing the dropdown
        btn.click();
        resolve(false);
      }, 300);
    });
  }

  // ── Fill Workday multi-select typeahead ────────────────────────────────────
  // Workday renders multi-select as a div with data-uxi-widget-type="multiselect"
  // Must click to open, simulate keyboard typing to trigger search, then select
  async function fillWorkdayMultiselect(container, value) {
    // Click the input container to open / focus
    const inputArea = container.querySelector('[data-automation-id="multiselectInputContainer"]');
    if (!inputArea) return false;
    inputArea.click();
    await new Promise(r => setTimeout(r, 300));

    // After clicking, Workday may render a real <input> inside the container
    let searchInput = container.querySelector('input[type="text"]:not([class*="hidden"])');
    if (!searchInput) searchInput = container.querySelector('input');
    if (!searchInput) {
      // Workday sometimes creates the input only after focus
      inputArea.focus();
      inputArea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      inputArea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      inputArea.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      searchInput = container.querySelector('input[type="text"]') || container.querySelector('input');
    }

    if (searchInput) {
      searchInput.focus();
      // Simulate typing character by character for Workday's React event handling
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      for (let i = 1; i <= value.length; i++) {
        const partial = value.substring(0, i);
        if (nativeSet) nativeSet.call(searchInput, partial);
        else searchInput.value = partial;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: value[i-1], bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: value[i-1], bubbles: true }));
      }
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Wait for suggestions to appear
    await new Promise(r => setTimeout(r, 1000));

    // Find and click the first matching option in any visible listbox
    const listboxes = document.querySelectorAll('[role="listbox"]');
    const lower = value.toLowerCase();
    for (const listbox of listboxes) {
      if (listbox.offsetParent === null) continue; // skip hidden
      const options = listbox.querySelectorAll('[role="option"]');
      for (const opt of options) {
        const text = (opt.textContent || '').trim().toLowerCase();
        if (text.includes(lower) || lower.includes(text)) {
          opt.click();
          return true;
        }
      }
    }

    // Fallback: try pressing Enter to select first suggestion
    if (searchInput) {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    return false;
  }

  // ── Auto-check consent/agreement checkboxes ────────────────────────────────
  // These are always checked regardless of Q&A rules — privacy notices, ToS, etc.
  function autoCheckConsentBoxes(log) {
    const consentPatterns = /consent|i agree|i acknowledge|i certify|i accept|i confirm|terms|privacy|notice|authorization|voluntary|self.?identification|i have read|i understand/i;
    let checked = 0;
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.closest('#jh-sidebar')) return;
      if (cb.checked) return;
      if (cb.disabled || cb.readOnly) return;
      const label = extractFieldLabel(cb);
      if (label && consentPatterns.test(label)) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('input', { bubbles: true }));
        cb.dispatchEvent(new Event('click', { bubbles: true }));
        if (log) logFill(log, `✓ Checked: ${label.substring(0, 60)}`, 'success');
        checked++;
      }
    });
    return checked;
  }

  // ── Resume upload ─────────────────────────────────────────────────────────
  let _resumeAlreadyUploaded = false; // Track across multiple Auto-Fill clicks

  async function uploadResume(resumeFile, log) {
    if (_resumeAlreadyUploaded) {
      logFill(log, '✓ Resume already uploaded (skipping)', 'success');
      return true;
    }

    if (!resumeFile || !resumeFile.data) {
      logFill(log, '⚠ No resume file linked for this type', 'warn');
      return false;
    }

    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) {
      logFill(log, '⚠ No file upload field found on page', 'warn');
      return false;
    }

    // Check if a file is already attached (native check + Workday DOM check)
    for (const input of fileInputs) {
      if (input.files && input.files.length > 0) {
        logFill(log, `✓ Resume already attached: ${input.files[0].name} (skipping)`, 'success');
        _resumeAlreadyUploaded = true;
        return true;
      }
    }
    // Workday renders uploaded files as data-automation-id="file-upload-item" anywhere on page
    const existingFiles = document.querySelectorAll('[data-automation-id="file-upload-item"]');
    if (existingFiles.length > 0) {
      const fileName = existingFiles[0].textContent?.trim().substring(0, 40) || 'file';
      logFill(log, `✓ Resume already attached: ${fileName} (skipping)`, 'success');
      _resumeAlreadyUploaded = true;
      return true;
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
      _resumeAlreadyUploaded = true;
      return true;
    }

    logFill(log, '⚠ Could not attach resume to file input', 'warn');
    return false;
  }

  // ── Resolve a matched key to an actual value ──────────────────────────────
  // Credentials are stored separately and passed in via runAutoFill
  let _credentials = {};

  function resolveValue(key, profile, qa) {
    // Special profile keys (prefixed with _)
    const nameParts = (profile.name || '').split(/\s+/);
    const map = {
      '_firstName':  nameParts[0] || '',
      '_lastName':   nameParts.slice(1).join(' ') || '',
      '_fullName':   profile.name || '',
      '_email':      _credentials.email || profile.email || '',
      '_phone':      profile.phone || '',
      '_street':     profile.street || '',
      '_street2':    '',
      '_city':       profile.city || '',
      '_state':      profile.state || '',
      '_zip':        profile.zip || '',
      '_country':    profile.country || 'United States',
      '_location':   profile.location || ((profile.city || '') + (profile.state ? ', ' + profile.state : '')),
      '_password':   _credentials.password || '',
      '_username':   _credentials.username || _credentials.email || profile.email || '',
      '_phoneType':  'Mobile',
      '_previouslyWorked': 'No',
      '_nonCompete':       'No',
      '_backgroundCheck':  'Yes',
      '_drugTest':         'Yes',
      '_criminalHistory':  'No',
      '_over18':           'Yes',
    };
    if (key in map) return map[key];
    // Q&A key
    if (key in qa) return qa[key] || '';
    // LinkedIn from profile as fallback
    if (key === 'linkedinUrl') return qa.linkedinUrl || profile.linkedin || '';
    return '';
  }

  // ── Main auto-fill ────────────────────────────────────────────────────────

  // Month number → name mapping (shared by experience + education fillers)
  const MONTH_NAMES = ['','January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  // Track elements handled by fillExperience/fillEducation so the main loop skips them
  // MUST be at module scope so runAutoFill can access it
  let experienceHandledElements = new Set();
  let educationHandledElements  = new Set();

  // Build a date value from month + year, respecting input type and placeholder
  function buildDateValue(month, year, inputEl) {
    const yr = String(year || '').trim();
    const mo = String(month || '').trim();
    const mm = mo ? mo.padStart(2, '0') : '';

    // NEVER produce partial dates — must have at least a year
    if (!yr || yr.length < 4) return '';

    const type = (inputEl?.type || '').toLowerCase();
    const placeholder = (inputEl?.placeholder || '').toLowerCase();

    // HTML month input expects YYYY-MM
    if (type === 'month') {
      return mm ? `${yr}-${mm}` : '';
    }
    // HTML date input expects YYYY-MM-DD
    if (type === 'date') {
      return mm ? `${yr}-${mm}-01` : '';
    }
    // Check placeholder for format hints
    if (placeholder.includes('mm/yyyy') || placeholder.includes('mm/yy')) {
      return mm ? `${mm}/${yr}` : '';
    }
    if (placeholder.includes('yyyy-mm')) {
      return mm ? `${yr}-${mm}` : '';
    }
    if (placeholder.includes('yyyy')) {
      return mm ? `${mm}/${yr}` : yr;
    }
    // Default: MM/YYYY for text inputs — NEVER return partial
    return mm ? `${mm}/${yr}` : yr;
  }

  // ── Fill work experience sections ──────────────────────────────────────────
  // Many ATS forms have repeating "Work Experience" blocks with fields for
  // title, company, start/end date, description, etc.
  async function fillExperience(workExperience, log, resumeType) {
    if (!workExperience || workExperience.length === 0) return 0;

    let filled = 0;

    // Experience field patterns — order matters for "from"/"to" disambiguation
    // Broadened for Workday + other ATS: handle aria-labels, data-automation IDs, etc.
    const expFieldPatterns = {
      title:       /job.*title|position.*title|^title$|^role$|^position$/i,
      company:     /company|employer|organization|firm/i,
      location:    /location|city/i,
      startMonth:  /start.*month|from.*month/i,
      startYear:   /start.*year|from.*year/i,
      startDate:   /start.*date|from.*date|begin.*date|^from\b|^from\s*\*/i,
      endMonth:    /end.*month|to.*month/i,
      endYear:     /end.*year|to.*year/i,
      endDate:     /end.*date|to.*date|^to\b|^to\s*\*/i,
      current:     /current.*work|currently.*work|i currently work|present.*employ|still.*work|work.*here/i,
      description: /responsibilit|description|duties|summary|accomplishment|role.*description/i,
    };

    // ── Workday-specific date filler ──
    // Workday uses custom spinbutton date inputs with data-automation-id
    // Standard fillField doesn't work — must set aria-valuenow/aria-valuetext
    // Set a Workday spinbutton value WITHOUT triggering events (silent)
    function setSpinbuttonValue(input, numericValue) {
      const val = String(numericValue);
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (nativeSet) nativeSet.call(input, val);
      else input.value = val;
      input.setAttribute('aria-valuenow', val);
      input.setAttribute('aria-valuetext', val);
      // Also update the display div (sibling with -display suffix)
      const displayId = input.id?.replace('-input', '-display');
      if (displayId) {
        const display = document.getElementById(displayId);
        if (display) display.textContent = val.padStart(2, '0');
      }
    }

    // Trigger events on a spinbutton AFTER value is set
    function triggerSpinbuttonEvents(input) {
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      input.blur();
    }

    function fillWorkdayDates(exp) {
      // Find all date wrappers with data-automation-id="dateInputWrapper"
      const wrappers = document.querySelectorAll('[data-automation-id="dateInputWrapper"]');
      let filled = 0;
      for (const wrapper of wrappers) {
        // Skip if already handled
        if (experienceHandledElements.has(wrapper)) continue;
        // Determine if this is a "From" or "To" date by checking the parent fieldset legend
        const fieldset = wrapper.closest('fieldset');
        if (!fieldset) continue;
        const legend = fieldset.querySelector('legend label, legend');
        const legendText = (legend?.innerText || '').trim().toLowerCase();
        const isFrom = /^from\b/.test(legendText);
        const isTo   = /^to\b/.test(legendText);
        if (!isFrom && !isTo) continue;

        // Find month and year spinbutton inputs inside this wrapper
        const monthInput = wrapper.querySelector('[data-automation-id="dateSectionMonth-input"]');
        const yearInput  = wrapper.querySelector('[data-automation-id="dateSectionYear-input"]');
        if (!monthInput && !yearInput) continue;

        experienceHandledElements.add(wrapper);
        if (monthInput) experienceHandledElements.add(monthInput);
        if (yearInput)  experienceHandledElements.add(yearInput);

        let month, year;
        if (isFrom) {
          month = exp.startMonth;
          year  = exp.startYear;
        } else if (isTo) {
          if (exp.current) continue; // skip end date for current job
          month = exp.endMonth;
          year  = exp.endYear;
        }

        // CRITICAL: Set BOTH values silently FIRST, then trigger events
        // This prevents Workday from validating month when year is still empty
        if (yearInput && year) {
          setSpinbuttonValue(yearInput, parseInt(year));
        }
        if (monthInput && month) {
          setSpinbuttonValue(monthInput, parseInt(month));
        }

        // NOW trigger events — year first so validation sees complete date
        if (yearInput && year) {
          triggerSpinbuttonEvents(yearInput);
          logFill(log, `✓ Experience: ${isFrom ? 'From' : 'To'} Year → ${year}`, 'success');
          filled++;
        }
        if (monthInput && month) {
          triggerSpinbuttonEvents(monthInput);
          logFill(log, `✓ Experience: ${isFrom ? 'From' : 'To'} Month → ${month}`, 'success');
          filled++;
        }
      }
      return filled;
    }

    // Reset the set each time fillExperience runs (fresh scan)
    experienceHandledElements = new Set();

    // Walk up DOM ancestors to find a group label containing "From" or "To"
    // This handles Workday-style split Month/Year fields nested under From*/To* groups
    function getDateGroupContext(el) {
      let parent = el.parentElement;
      for (let depth = 0; depth < 6 && parent; depth++) {
        // Check for labels, legends, or text nodes in this container
        const candidates = parent.querySelectorAll(':scope > label, :scope > legend, :scope > div > label, :scope > span, :scope > div > span, :scope > p');
        for (const c of candidates) {
          const t = (c.innerText || c.textContent || '').trim().toLowerCase();
          if (/^from\b/.test(t)) return 'from';
          if (/^to\b/.test(t))   return 'to';
        }
        // Also check the parent's own text (for cases like <div>From *<select>...</div>)
        const directText = Array.from(parent.childNodes)
          .filter(n => n.nodeType === 3) // text nodes only
          .map(n => n.textContent.trim().toLowerCase())
          .join(' ');
        if (/^from\b/.test(directText)) return 'from';
        if (/^to\b/.test(directText))   return 'to';
        parent = parent.parentElement;
      }
      return null;
    }

    // Fill one round of experience fields from the current DOM
    async function fillOneEntry(exp) {
      const allFields = scanFormFields();
      const usedFields = new Set();
      let entryFilled = 0;
      const orphanDateFields = []; // Fields labeled just "Month" or "Year" to resolve later

      for (const field of allFields) {
        // Skip fields already handled by a PREVIOUS entry
        if (experienceHandledElements.has(field.element)) continue;
        // Allow date fields that have partial/error values to be re-filled
        if (field.filled) {
          const existingVal = (field.element.value || '').trim();
          const isPartialDate = /^\/|error|^mm|^dd|^yyyy/i.test(existingVal) || (existingVal.length > 0 && existingVal.length < 3);
          if (!isPartialDate) continue;
        }
        if (usedFields.has(field.element)) continue;
        const label = field.label.toLowerCase().trim();
        if (!label) continue;

        // Collect orphan "Month" / "Year" fields for date group resolution
        if (/^month\s*\*?$/.test(label) || /^year\s*\*?$/.test(label)) {
          orphanDateFields.push(field);
          continue;
        }

        let matched = false;
        for (const [key, rx] of Object.entries(expFieldPatterns)) {
          if (!rx.test(label)) continue;
          matched = true;

          console.log(`JobHunter: Experience field matched — label="${label}" key=${key} type=${field.element.type} existingValue="${field.element.value || ''}"`);
          // Mark as handled by experience filler regardless of whether we can fill it
          experienceHandledElements.add(field.element);

          let value = '';
          switch (key) {
            case 'title': {
              const v = exp.variants && resumeType && exp.variants[resumeType];
              value = (v && v.title) || exp.title || '';
              break;
            }
            case 'company':     value = exp.company || ''; break;
            case 'location':    value = exp.location || ''; break;
            case 'startMonth':  value = exp.startMonth ? MONTH_NAMES[parseInt(exp.startMonth)] : ''; break;
            case 'startYear':   value = exp.startYear || ''; break;
            case 'startDate':
              value = buildDateValue(exp.startMonth, exp.startYear, field.element);
              break;
            case 'endMonth':
              if (exp.current) { value = ''; }
              else { value = exp.endMonth ? MONTH_NAMES[parseInt(exp.endMonth)] : ''; }
              break;
            case 'endYear':
              value = exp.current ? '' : (exp.endYear || '');
              break;
            case 'endDate':
              if (exp.current) { value = ''; }
              else { value = buildDateValue(exp.endMonth, exp.endYear, field.element); }
              break;
            case 'current':
              if (exp.current) {
                value = 'Yes';
              }
              break;
            case 'description': {
              const v = exp.variants && resumeType && exp.variants[resumeType];
              value = (v && v.description) || exp.description || '';
              break;
            }
          }

          if (value) {
            // For date fields, clear partial/error values first (Workday pre-fills "/2026" etc.)
            if ((key === 'startDate' || key === 'endDate') && field.element.value) {
              const existing = field.element.value.trim();
              if (/^\/|error|^mm|^dd|^yyyy/i.test(existing) || existing.length < 3) {
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                if (nativeSet) nativeSet.call(field.element, '');
                else field.element.value = '';
                field.filled = false;
              }
            }
            // For "current" checkbox — click it directly if it's a checkbox
            if (key === 'current' && (field.fieldType === 'checkbox' || field.element.type === 'checkbox')) {
              if (!field.element.checked) {
                field.element.click();
                field.element.dispatchEvent(new Event('change', { bubbles: true }));
                logFill(log, `✓ Experience: ${label.substring(0, 40)} → checked`, 'success');
                usedFields.add(field.element);
                entryFilled++;
              }
            } else if (await fillField(field, value)) {
              logFill(log, `✓ Experience: ${label.substring(0, 40)} → ${value.substring(0, 30)}`, 'success');
              usedFields.add(field.element);
              entryFilled++;
            }
          } else if (!value) {
            // Suppress warnings for expected empty fields:
            // - "I currently work here" is only set on current jobs
            // - "To" dates are blank for current jobs
            const isExpectedEmpty = (key === 'current' && !exp.current) ||
              ((key === 'endDate' || key === 'endMonth' || key === 'endYear') && exp.current);
            if (!isExpectedEmpty) {
              logFill(log, `⚠ Experience: ${label.substring(0, 40)} — no data to fill`, 'warn');
            }
          }
          break; // matched a pattern, move to next field
        }
      }

      // ── Second pass: resolve orphan "Month" / "Year" fields by DOM context ──
      // Workday and similar ATS split dates into separate Month + Year fields
      // under a parent labeled "From *" or "To *"
      for (const field of orphanDateFields) {
        if (usedFields.has(field.element)) continue;
        // Skip if Workday-specific fillWorkdayDates already handled this
        if (experienceHandledElements.has(field.element)) continue;
        const label = field.label.toLowerCase().trim();
        const isMonth = /^month/.test(label);
        const isYear  = /^year/.test(label);
        const context = getDateGroupContext(field.element);

        console.log(`JobHunter: Orphan date field — label="${label}" context="${context}" type=${field.element.type}`);
        experienceHandledElements.add(field.element);

        let value = '';
        if (context === 'from') {
          if (isMonth && exp.startMonth) {
            // For selects, use month number or name depending on option values
            if (field.fieldType === 'select') {
              value = exp.startMonth ? MONTH_NAMES[parseInt(exp.startMonth)] : '';
            } else {
              value = String(exp.startMonth).padStart(2, '0');
            }
          }
          if (isYear) value = exp.startYear || '';
        } else if (context === 'to') {
          if (exp.current) {
            value = ''; // skip end date for current job
          } else {
            if (isMonth && exp.endMonth) {
              if (field.fieldType === 'select') {
                value = exp.endMonth ? MONTH_NAMES[parseInt(exp.endMonth)] : '';
              } else {
                value = String(exp.endMonth).padStart(2, '0');
              }
            }
            if (isYear) value = exp.endYear || '';
          }
        }

        if (value && await fillField(field, value)) {
          logFill(log, `✓ Experience: ${context || '?'} ${label} → ${value}`, 'success');
          usedFields.add(field.element);
          entryFilled++;
        } else if (!value && context) {
          // Only warn if it's NOT an expected empty (current job has no To date)
          if (!(context === 'to' && exp.current)) {
            logFill(log, `⚠ Experience: ${context} ${label} — no data to fill`, 'warn');
          }
        } else if (!context) {
          logFill(log, `⚠ Experience: ${label} — could not determine From/To context`, 'warn');
        }
      }

      return entryFilled;
    }

    // Try to click "Add Another" / "Add Work Experience" buttons
    function clickAddAnother() {
      const addBtnPatterns = /add\s*(another|more|new|work|experience|entry|position|employment)|add\s*$/i;
      const btns = document.querySelectorAll('button, a, [role="button"], input[type="button"]');
      for (const btn of btns) {
        if (btn.closest('#jh-sidebar')) continue;
        const text = (btn.textContent || btn.value || '').trim();
        if (addBtnPatterns.test(text)) {
          btn.click();
          logFill(log, `✓ Clicked "${text.substring(0, 30)}" to add experience entry`, 'success');
          return true;
        }
      }
      return false;
    }

    // Fill first entry from existing fields
    // Workday-specific: fill spinbutton dates FIRST so fillOneEntry can skip them
    filled += fillWorkdayDates(workExperience[0]);
    const firstFilled = await fillOneEntry(workExperience[0]);
    filled += firstFilled;

    // For remaining entries, click "Add Another" and fill
    for (let i = 1; i < workExperience.length; i++) {
      if (!clickAddAnother()) {
        logFill(log, `Could not find "Add Another" button for experience entry ${i + 1}`, 'warn');
        break;
      }
      // Wait for new empty fields to appear in the DOM after clicking Add Another
      await new Promise(resolve => setTimeout(resolve, 800));
      // Workday-specific: fill spinbutton dates FIRST
      filled += fillWorkdayDates(workExperience[i]);
      const entryFilled = await fillOneEntry(workExperience[i]);
      if (entryFilled === 0 && filled === 0) {
        logFill(log, `No fields found for experience entry ${i + 1}`, 'warn');
        break;
      }
    }

    return filled;
  }

  // ── Fill education sections ────────────────────────────────────────────────
  // Similar to fillExperience but for education blocks (School, Degree, etc.)
  async function fillEducation(educationData, log) {
    if (!educationData || educationData.length === 0) return 0;

    let filled = 0;

    const eduFieldPatterns = {
      school:      /school|university|college|institution|^school\s*name/i,
      degree:      /degree|education.*level|^degree\b/i,
      fieldOfStudy:/field.*study|major|concentration|discipline|area.*study/i,
      gpa:         /gpa|grade.*point|cumulative/i,
      startDate:   /start.*date|from.*date|^from\b|^from\s*\*/i,
      endDate:     /end.*date|to.*date|^to\b|^to\s*\*|graduat.*date|completion.*date/i,
      startYear:   /start.*year|from.*year/i,
      endYear:     /end.*year|to.*year|graduat.*year|year.*graduat|class.*of|completion.*year/i,
    };

    // Reset education handled set
    educationHandledElements = new Set();

    async function fillOneEduEntry(edu) {
      const allFields = scanFormFields();
      const usedFields = new Set();
      let entryFilled = 0;

      for (const field of allFields) {
        if (field.filled) continue;
        if (usedFields.has(field.element)) continue;
        // Skip fields already claimed by experience filler
        if (experienceHandledElements.has(field.element)) continue;
        const label = field.label.toLowerCase().trim();
        if (!label) continue;

        for (const [key, rx] of Object.entries(eduFieldPatterns)) {
          if (!rx.test(label)) continue;

          educationHandledElements.add(field.element);

          let value = '';
          switch (key) {
            case 'school':       value = edu.school || ''; break;
            case 'degree':       value = edu.degree || ''; break;
            case 'fieldOfStudy': value = edu.fieldOfStudy || ''; break;
            case 'gpa':          value = edu.gpa || ''; break;
            case 'startDate':
              value = buildDateValue(edu.startMonth, edu.startYear, field.element);
              break;
            case 'endDate':
              value = buildDateValue(edu.endMonth, edu.endYear, field.element);
              break;
            case 'startYear': value = edu.startYear || ''; break;
            case 'endYear':   value = edu.endYear || ''; break;
          }

          if (value && await fillField(field, value)) {
            logFill(log, `✓ Education: ${label.substring(0, 40)} → ${value.substring(0, 30)}`, 'success');
            usedFields.add(field.element);
            entryFilled++;
          } else if (!value) {
            logFill(log, `⚠ Education: ${label.substring(0, 40)} — no data`, 'warn');
          }
          break;
        }
      }
      return entryFilled;
    }

    // Click "Add Education" / "Add Another" type buttons
    function clickAddEdu() {
      const addBtnPatterns = /add\s*(another|more|new)?\s*(education|school|degree)|add\s*$/i;
      const btns = document.querySelectorAll('button, a, [role="button"], input[type="button"]');
      for (const btn of btns) {
        if (btn.closest('#jh-sidebar')) continue;
        const text = (btn.textContent || btn.value || '').trim();
        if (addBtnPatterns.test(text)) {
          btn.click();
          logFill(log, `✓ Clicked "${text.substring(0, 30)}" to add education entry`, 'success');
          return true;
        }
      }
      return false;
    }

    const firstFilled = await fillOneEduEntry(educationData[0]);
    filled += firstFilled;

    for (let i = 1; i < educationData.length; i++) {
      if (!clickAddEdu()) {
        logFill(log, `Could not find "Add" button for education entry ${i + 1}`, 'warn');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 800));
      const entryFilled = await fillOneEduEntry(educationData[i]);
      filled += entryFilled;
      if (entryFilled === 0) break;
    }

    return filled;
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
        { type: 'GET_AUTOFILL_DATA', resumeType, pageUrl: location.href },
        resolve
      );
    });

    const profile    = data.profile    || {};
    const qa         = data.qa         || {};
    const customQA   = data.customQA   || [];
    const skipFields = data.skipFields || [];
    _credentials     = data.credentials || {};

    // 1. Auto-check consent/agreement checkboxes
    logFill(log, 'Checking consent boxes...', 'info');
    const consentCount = autoCheckConsentBoxes(log);
    if (consentCount > 0) logFill(log, `Checked ${consentCount} consent box(es)`, 'success');

    // 2. Upload resume
    logFill(log, 'Looking for resume upload field...', 'info');
    await uploadResume(data.resumeFile, log);

    // 3. Fill work experience sections
    const workExp = data.workExperience || [];
    if (workExp.length > 0) {
      logFill(log, `Filling work experience (${workExp.length} entries)...`, 'info');
      const expFilled = await fillExperience(workExp, log, resumeType);
      if (expFilled > 0) logFill(log, `Filled ${expFilled} experience field(s)`, 'success');
    }

    // 3b. Fill education sections
    const eduData = data.education || [];
    if (eduData.length > 0) {
      logFill(log, `Filling education (${eduData.length} entries)...`, 'info');
      const eduFilled = await fillEducation(eduData, log);
      if (eduFilled > 0) logFill(log, `Filled ${eduFilled} education field(s)`, 'success');
    }

    // 4. Scan all form fields
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

      // Skip fields that were handled (or attempted) by fillExperience or fillEducation
      if (experienceHandledElements.has(field.element)) { skipped++; continue; }
      if (educationHandledElements.has(field.element)) { skipped++; continue; }

      const label = field.label;

      // Also skip experience/education-like labels by text pattern (catches fields from
      // entries we didn't have data for, or labels with error text appended)
      const labelFirst = label.split('\n')[0].trim(); // strip error messages after newline
      if (/^(from|to|month|year|job\s*title|company|employer|role\s*desc|responsibilities|i currently work|school|university|degree|field of study|major|gpa)\b/i.test(labelFirst)) {
        skipped++; continue;
      }

      // User-configured skip list — skip fields matching any skip pattern
      const labelLower = label.toLowerCase();
      const shouldSkip = skipFields.some(pat => labelLower.includes(pat.toLowerCase()));
      if (shouldSkip) {
        logFill(log, `⊘ ${label} — skipped (skip list)`, 'info');
        skipped++; continue;
      }

      // A. Check custom Q&A first (user-defined exact/fuzzy matches)
      let matchedCustom = false;
      for (const pair of customQA) {
        if (!pair.question || !pair.answer) continue;
        const q = pair.question.toLowerCase();
        const l = label.toLowerCase();
        // Check if custom question matches the field label
        if (l.includes(q) || q.includes(l) || fuzzyScore(l, q) > 0.6) {
          if (await fillField(field, pair.answer)) {
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
          if (await fillField(field, value)) {
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
            if (await fillField(field, resp.answer)) {
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
        logFill(log, `⚠ ${field.label} — no match (start Claude CLI server for smart fill)`, 'warn');
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

  // ── Workday / ATS "Start Application" auto-click ──────────────────────────
  // On Workday's "Start Your Application" page, auto-click "Apply Manually"
  // to skip the splash screen and go straight to the form.
  function tryAutoClickApply() {
    const hostname = location.hostname;
    if (!hostname.includes('workday') && !hostname.includes('myworkdayjobs')) return;

    // Look for "Apply Manually" or "Apply" links/buttons on the start page
    const applyTexts = ['apply manually', 'apply now', 'apply with resume'];
    const buttons = document.querySelectorAll('a, button');
    for (const btn of buttons) {
      const text = btn.innerText?.trim()?.toLowerCase();
      if (text && applyTexts.includes(text)) {
        console.log('JobHunter: Found "' + btn.innerText.trim() + '" button, auto-clicking...');
        setTimeout(() => btn.click(), 800);
        return true;
      }
    }
    return false;
  }

  // ── Main init ──────────────────────────────────────────────────────────────
  let sidebarVisible = false;

  async function init() {
    if (document.getElementById('jh-sidebar')) return;

    // Load dynamic job types before building UI
    await loadJobTypes();

    const sidebar   = createSidebar();
    const toggleTab = createToggleTab();

    // Populate job type selector from dynamic types
    const jtSelect = document.getElementById('jh-jobtype');
    jtSelect.innerHTML = JOB_TYPE_KEYS.map(k =>
      `<option value="${k}">${JOB_TYPE_LABELS[k] || k}</option>`
    ).join('');

    let resumeNames = {};
    let resumeFilesInfo = {};
    let currentJobType = JOB_TYPE_KEYS[0] || 'it-mgmt';
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

    // ── Smart auto-show: ask background if this is a job-related site ────────
    // Start collapsed by default; expand only on job boards & ATS sites
    collapseSidebar();

    chrome.runtime.sendMessage({ type: 'IS_JOB_SITE', url: location.href }, siteInfo => {
      if (!siteInfo) return;

      if (siteInfo.isJobBoard) {
        // On a job board (LinkedIn, Indeed, etc.) — expand sidebar and scan
        console.log('JobHunter: Job board detected, expanding sidebar');
        expandSidebar();
        setTimeout(() => {
          scanPage();
          // Store job context so it carries over if user clicks Apply → ATS
          setTimeout(() => {
            if (currentJob && currentJob.title) {
              chrome.runtime.sendMessage({
                type: 'SET_JOB_CONTEXT',
                job: { ...currentJob, jobType: currentJobType },
              });
              console.log('JobHunter: Stored job context:', currentJob.title);
            }
          }, 600);
        }, 500);
      } else if (siteInfo.isATS) {
        // On an ATS site (Workday, Greenhouse, etc.) — check for carried-over context
        console.log('JobHunter: ATS site detected, checking for job context');
        expandSidebar();

        // Try auto-clicking through "Start Application" splash pages
        tryAutoClickApply();

        chrome.runtime.sendMessage({ type: 'GET_JOB_CONTEXT' }, ctx => {
          if (ctx && ctx.title) {
            console.log('JobHunter: Found carried-over job context:', ctx.title);
            document.getElementById('jh-job-title').textContent   = ctx.title;
            document.getElementById('jh-job-company').textContent  = ctx.company || '';
            document.getElementById('jh-job-location').textContent = ctx.location || '';
            document.getElementById('jh-job-platform').textContent = `${ctx.platform || ''} → ${location.hostname}`;
            currentJob = ctx;
            if (ctx.jobType) {
              currentJobType = ctx.jobType;
              document.getElementById('jh-jobtype').value = ctx.jobType;
              updateResumeFileDisplay();
            }
          } else {
            // No context — scan the ATS page itself
            setTimeout(scanPage, 500);
          }
        });
      } else if (siteInfo.isJobRelated) {
        // Job-related but not specifically a board or ATS — show but collapsed
        setTimeout(scanPage, 500);
      } else {
        // Not a job site — stay collapsed, still scan in background
        setTimeout(scanPage, 500);
      }
    });

    // Check saved preference (override auto-show if user explicitly collapsed)
    chrome.storage.local.get(['sidebarCollapsed'], r => {
      if (r.sidebarCollapsed && sidebarVisible) collapseSidebar();
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

            // Update job context on job boards during SPA navigation
            chrome.runtime.sendMessage({ type: 'IS_JOB_SITE', url: location.href }, siteInfo => {
              if (siteInfo?.isJobBoard && job.title) {
                chrome.runtime.sendMessage({
                  type: 'SET_JOB_CONTEXT',
                  job: { ...job, jobType: document.getElementById('jh-jobtype')?.value || 'it-mgmt' },
                });
              }
            });
          }, 800);
        } else {
          init();
        }
      }, 300);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
