// JobHunter — Content Script
// Runs on job listing and application pages

(function () {
  'use strict';

  if (window.__jobhunterLoaded) return;
  window.__jobhunterLoaded = true;

  let currentJob = null;
  let panel = null;
  let fab = null;

  // ─── Site Detectors ────────────────────────────────────────────────────────
  const DETECTORS = [
    {
      name: 'LinkedIn',
      match: () => location.hostname.includes('linkedin.com') && location.pathname.includes('/jobs/'),
      detect: () => {
        const title = qs('.job-details-jobs-unified-top-card__job-title h1, .jobs-unified-top-card__job-title h1, .job-details-jobs-unified-top-card__job-title, h1.t-24, h1[class*="job-title"]');
        const company = qs('.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a, [class*="company-name"] a, [class*="companyName"]');
        const location = qs('.job-details-jobs-unified-top-card__primary-description .tvm__text, .jobs-unified-top-card__bullet, [class*="topcard__flavor--bullet"]');
        const desc = qs('.jobs-description__content, .job-details-jobs-unified-top-card__container--two-pane, #job-details');
        return build(title, company, location, desc, 'LinkedIn');
      }
    },
    {
      name: 'Indeed',
      match: () => location.hostname.includes('indeed.com'),
      detect: () => {
        const title = qs('[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title, h1[class*="icl-u-xs-mb"]');
        const company = qs('[data-testid="inlineHeader-companyName"] a, [data-company-name], .jobsearch-InlineCompanyRating-companyHeader');
        const location = qs('[data-testid="job-location"], [class*="jobsearch-JobInfoHeader-subtitle"] .icl-u-xs-mt--xs');
        const desc = qs('#jobDescriptionText, .jobsearch-jobDescriptionText');
        return build(title, company, location, desc, 'Indeed');
      }
    },
    {
      name: 'Workday',
      match: () => location.hostname.includes('myworkdayjobs.com'),
      detect: () => {
        const title = qs('[data-automation-id="jobPostingHeader"], h2.css-1i0e50t');
        const company = qs('[data-automation-id="company"]') || { textContent: location.hostname.split('.')[0] };
        const location = qs('[data-automation-id="locations"], [data-automation-id="location"]');
        const desc = qs('[data-automation-id="jobPostingDescription"]');
        return build(title, company, location, desc, 'Workday');
      }
    },
    {
      name: 'Greenhouse',
      match: () => location.hostname.includes('greenhouse.io'),
      detect: () => {
        const title = qs('#header h1, .app-title, h1.app-title');
        const company = qs('#header .company-name, .company-name');
        const location = qs('.location, #header .location, .posting-headline .sort-by-time');
        const desc = qs('#content .section-wrapper, .content');
        return build(title, company, location, desc, 'Greenhouse');
      }
    },
    {
      name: 'Lever',
      match: () => location.hostname.includes('lever.co'),
      detect: () => {
        const title = qs('.posting-headline h2, [data-qa="posting-name"]');
        const company = qs('.main-header-logo img');
        const location = qs('[data-qa="posting-location"], .sort-by-time .location');
        const desc = qs('.posting-description, [data-qa="posting-description"]');
        const companyText = company ? (company.alt || company.textContent) : '';
        return {
          title: title?.textContent?.trim(),
          company: companyText?.trim() || location?.hostname,
          location: location?.textContent?.trim(),
          description: desc?.textContent?.trim()?.slice(0, 3000),
          url: location.href,
          platform: 'Lever'
        };
      }
    },
    {
      name: 'Ashby',
      match: () => location.hostname.includes('ashbyhq.com'),
      detect: () => {
        const title = qs('h1, [class*="JobPosting"] h1');
        const company = qs('[class*="companyName"], [class*="CompanyName"]');
        const loc = qs('[class*="location"], [class*="Location"]');
        return build(title, company, loc, null, 'Ashby');
      }
    },
    {
      name: 'Glassdoor',
      match: () => location.hostname.includes('glassdoor.com'),
      detect: () => {
        const title = qs('[data-test="job-title"], .job-title, h1[class*="title"]');
        const company = qs('[data-test="employer-name"], [class*="employer-name"]');
        const loc = qs('[data-test="location"], [class*="location"]');
        const desc = qs('[data-test="jobDescriptionContent"], #JobDescriptionContainer');
        return build(title, company, loc, desc, 'Glassdoor');
      }
    },
    {
      name: 'SmartRecruiters',
      match: () => location.hostname.includes('smartrecruiters.com'),
      detect: () => {
        const title = qs('.job-title, h1[class*="title"]');
        const company = qs('.company-name, [class*="company"]');
        const loc = qs('[class*="location"]');
        return build(title, company, loc, null, 'SmartRecruiters');
      }
    },
    {
      name: 'Bamboo',
      match: () => location.hostname.includes('bamboohr.com'),
      detect: () => {
        const title = qs('.BH-JobPostingTitle, h2[class*="title"]');
        const company = qs('.BH-JobPostingCompany, [class*="company"]');
        const loc = qs('.BH-JobPostingLocation, [class*="location"]');
        return build(title, company, loc, null, 'BambooHR');
      }
    },
    {
      name: 'Workable',
      match: () => location.hostname.includes('workable.com'),
      detect: () => {
        const title = qs('h1[data-ui="job-title"], h1');
        const company = qs('[data-ui="company-name"], [class*="companyName"]');
        const loc = qs('[data-ui="job-location"], [class*="location"]');
        return build(title, company, loc, null, 'Workable');
      }
    }
  ];

  function build(titleEl, companyEl, locationEl, descEl, platform) {
    const title = titleEl?.textContent?.trim();
    if (!title) return null;
    return {
      title,
      company: companyEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      description: descEl?.textContent?.trim()?.slice(0, 3000) || '',
      url: window.location.href,
      platform
    };
  }

  function qs(selector) {
    try { return document.querySelector(selector); } catch { return null; }
  }

  // ─── Detection Loop ────────────────────────────────────────────────────────
  function detectAndRender() {
    removeFAB();
    currentJob = null;

    for (const detector of DETECTORS) {
      if (detector.match()) {
        try {
          const job = detector.detect();
          if (job?.title) {
            currentJob = job;
            showFAB();
            break;
          }
        } catch (e) { /* try next */ }
      }
    }
  }

  // ─── Floating Action Button ────────────────────────────────────────────────
  function showFAB() {
    fab = document.createElement('div');
    fab.id = 'jh-fab';
    fab.innerHTML = `<span class="jh-fab-icon">🎯</span><span class="jh-fab-label">Save Job</span>`;
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);
  }

  function removeFAB() {
    document.getElementById('jh-fab')?.remove();
    document.getElementById('jh-panel')?.remove();
    fab = null;
    panel = null;
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────
  function togglePanel() {
    if (panel) { panel.remove(); panel = null; return; }

    panel = document.createElement('div');
    panel.id = 'jh-panel';
    panel.innerHTML = `
      <div class="jh-panel-header">
        <div class="jh-panel-logo">🎯 JobHunter</div>
        <button class="jh-close-btn" id="jh-close">✕</button>
      </div>
      <div class="jh-panel-body">
        <div class="jh-job-card">
          <div class="jh-job-title">${esc(currentJob.title)}</div>
          <div class="jh-job-meta">
            <span class="jh-company">${esc(currentJob.company)}</span>
            ${currentJob.location ? `<span class="jh-sep">·</span><span class="jh-loc">${esc(currentJob.location)}</span>` : ''}
          </div>
          <span class="jh-platform-badge">${esc(currentJob.platform)}</span>
        </div>

        <div class="jh-btn-stack">
          <button class="jh-btn jh-btn-save" id="jh-save">💾 Save to Tracker</button>
          <button class="jh-btn jh-btn-apply" id="jh-autofill">⚡ Auto-Fill This Form</button>
          <button class="jh-btn jh-btn-dash" id="jh-dash">📊 Open Dashboard</button>
        </div>

        <div id="jh-status" class="jh-status"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('jh-close').addEventListener('click', () => { panel.remove(); panel = null; });
    document.getElementById('jh-save').addEventListener('click', saveJob);
    document.getElementById('jh-autofill').addEventListener('click', doAutofill);
    document.getElementById('jh-dash').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    });
  }

  async function saveJob() {
    setStatus('Saving…', 'info');
    const res = await chrome.runtime.sendMessage({ type: 'SAVE_JOB', job: currentJob });
    if (res.success) {
      setStatus('✅ Saved!', 'success');
      const btn = document.getElementById('jh-save');
      if (btn) { btn.textContent = '✅ Saved'; btn.disabled = true; }
    } else {
      setStatus('❌ Error saving', 'error');
    }
  }

  async function doAutofill() {
    setStatus('Loading profile…', 'info');
    const res = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
    if (!res.success || !res.data?.email) {
      setStatus('⚠️ Set up your profile first!', 'warn');
      setTimeout(() => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }), 1200);
      return;
    }

    const count = autofill(res.data);
    if (count > 0) {
      setStatus(`⚡ Filled ${count} field${count !== 1 ? 's' : ''}!`, 'success');
      // Auto-save when filling
      chrome.runtime.sendMessage({ type: 'SAVE_JOB', job: { ...currentJob, status: 'applied' } });
    } else {
      setStatus('ℹ️ No fillable fields found on this page', 'warn');
    }
  }

  function setStatus(msg, type) {
    const el = document.getElementById('jh-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `jh-status jh-status-${type}`;
  }

  // ─── Autofill Engine ───────────────────────────────────────────────────────
  function autofill(profile) {
    let filled = 0;

    const FIELD_MAP = [
      { patterns: [/\bfirst\s*name\b|\bfirstname\b|\bgiven\s*name\b/i], value: () => profile.firstName },
      { patterns: [/\blast\s*name\b|\blastname\b|\bfamily\s*name\b|\bsurname\b/i], value: () => profile.lastName },
      { patterns: [/\b(full\s*name|your\s*name|(?<!first|last)\bname\b)\b/i], value: () => `${profile.firstName} ${profile.lastName}`.trim(), skip: /first|last/i },
      { patterns: [/\bemail\b|\be-mail\b/i], value: () => profile.email },
      { patterns: [/\b(phone|mobile|cell|telephone|tel)\b/i], value: () => profile.phone },
      { patterns: [/\blinkedin\b/i], value: () => profile.linkedin },
      { patterns: [/\bgithub\b/i], value: () => profile.github },
      { patterns: [/\b(website|portfolio|personal\s*url|personal\s*site|url)\b/i], value: () => profile.website },
      { patterns: [/\bstreet\b|\baddress\s*line\s*1\b|\baddress\b/i], value: () => profile.address, skip: /email/i },
      { patterns: [/\bcity\b/i], value: () => profile.city },
      { patterns: [/\bstate\b/i, /\bprovince\b/i], value: () => profile.state },
      { patterns: [/\b(zip|postal\s*code|postcode)\b/i], value: () => profile.zip },
      { patterns: [/\bcountry\b/i], value: () => profile.country },
      { patterns: [/\b(current\s*title|job\s*title|position\s*title|your\s*title)\b/i], value: () => profile.currentTitle },
      { patterns: [/\byears?.*(experience|exp)\b|\bexperience.*(years?)\b/i], value: () => profile.yearsExperience },
      { patterns: [/\b(desired|expected|salary|compensation|pay)\b/i], value: () => profile.salaryExpectation, skip: /minimum|min/i },
      { patterns: [/\bminimum.*salary\b|\bsalary.*min\b/i], value: () => profile.salaryMin },
    ];

    document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([disabled]), textarea:not([disabled])').forEach(input => {
      const ctx = getContext(input).toLowerCase();

      for (const rule of FIELD_MAP) {
        if (rule.skip && rule.skip.test(ctx)) continue;
        if (rule.patterns.some(p => p.test(ctx))) {
          const val = rule.value();
          if (val) {
            setInputValue(input, val);
            filled++;
          }
          break;
        }
      }
    });

    // SELECT elements
    document.querySelectorAll('select:not([disabled])').forEach(sel => {
      const ctx = getContext(sel).toLowerCase();

      if (/\bcountry\b/.test(ctx)) {
        setSelectValue(sel, profile.country) && filled++;
      } else if (/\bstate\b/.test(ctx)) {
        setSelectValue(sel, profile.state) && filled++;
      } else if (/\bwork\s*auth|\bauthoriz|\belig/.test(ctx)) {
        setSelectValue(sel, 'citizen') && filled++;
      } else if (/\bsponsor/.test(ctx)) {
        setSelectValue(sel, 'no') && filled++;
      }
    });

    // Radio groups
    filled += handleRadios(profile);

    return filled;
  }

  function getContext(el) {
    const parts = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('placeholder') || '',
      getLabelText(el),
      getClosestHeading(el)
    ];
    return parts.join(' ');
  }

  function getLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent;
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const texts = labelledBy.split(' ').map(id => document.getElementById(id)?.textContent || '');
      return texts.join(' ');
    }

    // Sibling/parent label-like elements
    const parent = el.parentElement;
    if (parent) {
      const labelEl = parent.querySelector('label, .label, [class*="label"], [class*="Label"], .field-label');
      if (labelEl && !labelEl.contains(el)) return labelEl.textContent;
    }
    return '';
  }

  function getClosestHeading(el) {
    let node = el.parentElement;
    for (let i = 0; i < 6; i++) {
      if (!node) break;
      const h = node.querySelector('h1,h2,h3,h4,legend,[class*="heading"],[class*="question"]');
      if (h && h !== el) return h.textContent;
      node = node.parentElement;
    }
    return '';
  }

  function setInputValue(input, value) {
    try {
      // React / Vue native input setter
      const proto = input.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;

      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur',   { bubbles: true }));
      input.style.outline = '2px solid #10b981'; // green highlight
    } catch {}
  }

  function setSelectValue(sel, matchStr) {
    const lower = matchStr.toLowerCase();
    const option = Array.from(sel.options).find(o =>
      o.text.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower)
    );
    if (option) {
      sel.value = option.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.style.outline = '2px solid #10b981';
      return true;
    }
    return false;
  }

  function handleRadios(profile) {
    let filled = 0;
    const groups = {};
    document.querySelectorAll('input[type="radio"]:not([disabled])').forEach(r => {
      const key = r.name || r.closest('fieldset')?.id || JSON.stringify([...r.closest('div,fieldset,section')?.querySelectorAll('input[type="radio"]') || []].map(x => x.value));
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    Object.values(groups).forEach(radios => {
      const ctx = (getClosestHeading(radios[0]) + ' ' + getLabelText(radios[0])).toLowerCase();
      let target = null;

      if (/sponsor|visa/.test(ctx))        target = profile.requireSponsorship === 'Yes' ? 'yes' : 'no';
      else if (/veteran|military/.test(ctx)) target = profile.veteran === 'Yes' ? 'yes' : 'no';
      else if (/disabilit/.test(ctx))        target = profile.disability === 'Yes' ? 'yes' : 'no';
      else if (/gender/.test(ctx) && profile.gender) target = profile.gender.toLowerCase();
      else if (/us\s*citizen|work\s*auth|authorized|legally\s*eligible/.test(ctx)) target = 'yes';

      if (target) {
        const match = radios.find(r => {
          const rl = (r.value + ' ' + getLabelText(r)).toLowerCase();
          return rl.includes(target);
        });
        if (match) {
          match.checked = true;
          match.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
      }
    });

    return filled;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── SPA Navigation ───────────────────────────────────────────────────────
  let lastUrl = location.href;

  function watchNavigation() {
    // MutationObserver for URL changes (SPAs)
    const obs = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(detectAndRender, 1200);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Also intercept pushState
    const orig = history.pushState.bind(history);
    history.pushState = function (...args) {
      orig(...args);
      setTimeout(detectAndRender, 1200);
    };
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { detectAndRender(); watchNavigation(); });
  } else {
    detectAndRender();
    watchNavigation();
  }

})();
