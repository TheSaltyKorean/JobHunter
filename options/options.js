// JobHunter — Options Page
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_JOB_TYPES = [
  { key: 'cloud',     label: 'Cloud & Infra',      emoji: '☁️', description: 'AWS, Azure, DevOps roles',     keywords: 'cloud,aws,azure,gcp,google cloud,infrastructure,devops,site reliability,sre,platform engineer,kubernetes,k8s,terraform,ansible,datacenter,network engineer,systems engineer,cloud architect,solutions architect,vmware,devsecops,mlops,finops,cloud security', resumeFile: 'cloud.pdf' },
  { key: 'it-mgmt',   label: 'IT Management',      emoji: '💼', description: 'Default for general IT roles', keywords: '',                                                                                                                                                                                                                                                     resumeFile: 'it-mgmt.pdf' },
  { key: 'executive', label: 'Executive',           emoji: '🏆', description: 'VP, CIO, Director-level',     keywords: 'vp ,vice president,cto,cio,ciso,cxo,svp,evp,chief information,chief technology,chief digital,chief data,managing director,global head,head of it,head of technology,president of,group director,it director',                                                  resumeFile: 'executive.pdf' },
  { key: 'staffing',  label: 'Staffing / Contract', emoji: '🏢', description: 'Auto-detected by firm name',  keywords: 'infosys,wipro,tcs,tata consultancy,hcl,cognizant,tech mahindra,capgemini,kforce,apex,collabera',                                                                                                                                                           resumeFile: 'staffing.pdf' },
];

const DEFAULT_QA = {
  yearsExperience: '', workAuthorization: 'Authorized to work in the US',
  sponsorship: 'No', willingToRelocate: 'Yes', desiredSalary: '',
  startDate: 'Immediately', veteranStatus: 'I am not a protected veteran',
  disabilityStatus: 'I do not wish to answer', gender: 'I do not wish to answer',
  ethnicity: 'I do not wish to answer', educationLevel: '', university: '',
  graduationYear: '', linkedinUrl: '', githubUrl: '', websiteUrl: '',
};

const QA_FIELDS = [
  'yearsExperience', 'workAuthorization', 'sponsorship', 'willingToRelocate',
  'desiredSalary', 'startDate', 'veteranStatus', 'disabilityStatus',
  'gender', 'ethnicity', 'educationLevel', 'university', 'graduationYear',
  'linkedinUrl', 'githubUrl', 'websiteUrl',
];

// Live job types — loaded from storage, used by experience tabs
let currentJobTypes = [];

// ── Load saved data into form ─────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(['profile', 'qaAnswers'], r => {
    const p  = r.profile || {};
    const qa = { ...DEFAULT_QA, ...(r.qaAnswers || {}) };

    // Profile fields
    document.getElementById('name').value     = p.name     || '';
    document.getElementById('email').value    = p.email    || '';
    document.getElementById('phone').value    = p.phone    || '';
    document.getElementById('street').value   = p.street   || '';
    document.getElementById('city').value     = p.city     || '';
    document.getElementById('state').value    = p.state    || '';
    document.getElementById('zip').value      = p.zip      || '';
    document.getElementById('country').value  = p.country  || '';
    document.getElementById('linkedin').value = p.linkedin || '';
    document.getElementById('title').value    = p.title    || '';
    document.getElementById('summary').value  = p.summary  || '';

    // Q&A fields
    for (const key of QA_FIELDS) {
      const el = document.getElementById(`qa-${key}`);
      if (el && qa[key] !== undefined) el.value = qa[key];
    }

    updateAvatar(p.name || '');
  });
}

function updateAvatar(name) {
  const el = document.getElementById('avatar-preview');
  if (!el) return;
  const parts = (name || '').trim().split(/\s+/);
  el.textContent = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0]?.[0] || '?').toUpperCase();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showSaved(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// ── Job Types management ───────────────────────────────────────────────────
function loadJobTypes() {
  chrome.storage.local.get(['jobTypes'], r => {
    const types = r.jobTypes && r.jobTypes.length ? r.jobTypes : DEFAULT_JOB_TYPES;
    currentJobTypes = types;
    const list = document.getElementById('jt-list');
    list.innerHTML = '';
    types.forEach((jt, i) => addJobTypeEntry(jt, i));
    updateAddJTButton();
    checkResumeFiles();
  });
}

function addJobTypeEntry(jt = {}, index) {
  const list = document.getElementById('jt-list');
  const num = index !== undefined ? index + 1 : list.children.length + 1;
  const entry = document.createElement('div');
  entry.className = 'jt-entry';

  entry.innerHTML = `
    <div class="jt-header">
      <div class="jt-number">${num}</div>
      ${num === 1 ? '<span class="jt-default-badge">Default</span>' : ''}
    </div>
    <button class="jt-remove" title="Remove">✕</button>
    <div class="exp-grid">
      <div class="field">
        <label class="field-label">Emoji</label>
        <input class="field-input jt-emoji" type="text" value="${escapeHtml(jt.emoji || '📄')}" placeholder="☁️" style="width:60px;text-align:center;font-size:18px;">
      </div>
      <div class="field">
        <label class="field-label">Label</label>
        <input class="field-input jt-label" type="text" value="${escapeHtml(jt.label || '')}" placeholder="e.g. Cloud & Infra" maxlength="30">
      </div>
      <div class="field">
        <label class="field-label">Short Description</label>
        <input class="field-input jt-desc" type="text" value="${escapeHtml(jt.description || '')}" placeholder="e.g. AWS, Azure, DevOps roles" maxlength="60">
      </div>
      <div class="field">
        <label class="field-label">Resume PDF Filename</label>
        <div style="display:flex;align-items:center;gap:6px;">
          <input class="field-input jt-file" type="text" value="${escapeHtml(jt.resumeFile || '')}" placeholder="e.g. cloud.pdf">
          <span class="jt-file-status"></span>
        </div>
      </div>
      <div class="field full">
        <label class="field-label">Detection Keywords (comma-separated)</label>
        <input class="field-input jt-keywords" type="text" value="${escapeHtml(jt.keywords || '')}" placeholder="cloud, aws, azure, gcp, devops...">
      </div>
    </div>
  `;

  entry.querySelector('.jt-remove').addEventListener('click', () => {
    if (list.children.length <= 1) { alert('You need at least one job type.'); return; }
    entry.remove();
    renumberJTEntries();
    updateAddJTButton();
  });

  list.appendChild(entry);
}

function renumberJTEntries() {
  document.querySelectorAll('.jt-entry').forEach((entry, i) => {
    entry.querySelector('.jt-number').textContent = i + 1;
    // Update default badge
    const existing = entry.querySelector('.jt-default-badge');
    if (i === 0 && !existing) {
      entry.querySelector('.jt-header').insertAdjacentHTML('beforeend', '<span class="jt-default-badge">Default</span>');
    } else if (i !== 0 && existing) {
      existing.remove();
    }
  });
}

function updateAddJTButton() {
  const btn = document.getElementById('add-jt');
  const count = document.querySelectorAll('.jt-entry').length;
  btn.disabled = count >= 6;
  btn.textContent = count >= 6 ? 'Maximum 6 types' : '+ Add Job Type';
}

function collectJobTypes() {
  const types = [];
  document.querySelectorAll('.jt-entry').forEach(entry => {
    const emoji       = entry.querySelector('.jt-emoji').value.trim() || '📄';
    const label       = entry.querySelector('.jt-label').value.trim();
    const description = entry.querySelector('.jt-desc').value.trim();
    const resumeFile  = entry.querySelector('.jt-file').value.trim();
    const keywords    = entry.querySelector('.jt-keywords').value.trim();
    // Auto-generate key from label
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `type-${types.length}`;
    if (label) {
      types.push({ key, label, emoji, description, keywords, resumeFile });
    }
  });
  return types;
}

async function checkResumeFiles() {
  document.querySelectorAll('.jt-entry').forEach(async entry => {
    const fileInput = entry.querySelector('.jt-file');
    const statusEl  = entry.querySelector('.jt-file-status');
    const filename  = fileInput.value.trim();
    if (!filename) { statusEl.textContent = ''; statusEl.className = 'jt-file-status'; return; }
    try {
      const url = chrome.runtime.getURL(`resumes/${filename}`);
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.size > 100 && blob.type !== 'text/html') {
          statusEl.textContent = `Found (${formatSize(blob.size)})`;
          statusEl.className = 'jt-file-status found';
          return;
        }
      }
    } catch (e) { /* ignore */ }
    statusEl.textContent = 'Missing';
    statusEl.className = 'jt-file-status missing';
  });
}

document.getElementById('add-jt').addEventListener('click', () => {
  if (document.querySelectorAll('.jt-entry').length >= 6) return;
  addJobTypeEntry({}, document.querySelectorAll('.jt-entry').length);
  updateAddJTButton();
});

document.getElementById('save-jt').addEventListener('click', () => {
  const types = collectJobTypes();
  if (types.length === 0) { alert('You need at least one job type with a label.'); return; }
  if (types.length > 6) { alert('Maximum 6 job types.'); return; }
  chrome.storage.local.set({ jobTypes: types }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      currentJobTypes = types;
      showSaved('jt-saved');
      checkResumeFiles();
    }
  });
});

// ── ATS Login Credentials (per-domain/URL) ────────────────────────────────
function loadCredentials() {
  chrome.storage.local.get(['atsCredentials', 'profile'], r => {
    let cred = r.atsCredentials || {};
    const profile = r.profile || {};

    // Migrate old flat format → new nested format
    if (cred.email !== undefined && !cred.default) {
      cred = { default: { email: cred.email || '', username: cred.username || '', password: cred.password || '' }, overrides: [] };
      chrome.storage.local.set({ atsCredentials: cred });
    }

    const def = cred.default || {};
    document.getElementById('cred-default-email').value    = def.email    || profile.email || '';
    document.getElementById('cred-default-username').value  = def.username || '';
    document.getElementById('cred-default-password').value  = def.password || '';

    const list = document.getElementById('cred-overrides-list');
    list.innerHTML = '';
    (cred.overrides || []).forEach(o => addCredOverrideRow(o.domain, o.email, o.username, o.password));
  });
}

function addCredOverrideRow(domain = '', email = '', username = '', password = '') {
  const list = document.getElementById('cred-overrides-list');
  const row = document.createElement('div');
  row.className = 'cred-row';
  row.innerHTML = `
    <div class="field cred-domain-field">
      <label class="field-label">Domain or URL</label>
      <input class="field-input cred-domain" type="text" value="${escapeHtml(domain)}" placeholder="e.g. myworkdayjobs.com">
    </div>
    <div class="field">
      <label class="field-label">Email</label>
      <input class="field-input cred-email" type="email" value="${escapeHtml(email)}" placeholder="Override email">
    </div>
    <div class="field">
      <label class="field-label">Username</label>
      <input class="field-input cred-user" type="text" value="${escapeHtml(username)}" placeholder="Optional">
    </div>
    <div class="field">
      <label class="field-label">Password</label>
      <input class="field-input cred-pass" type="password" value="${escapeHtml(password)}" placeholder="Override password">
    </div>
    <button class="cred-remove" title="Remove">✕</button>
  `;
  row.querySelector('.cred-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectCredentials() {
  const def = {
    email:    document.getElementById('cred-default-email').value.trim(),
    username: document.getElementById('cred-default-username').value.trim(),
    password: document.getElementById('cred-default-password').value,
  };
  const overrides = [];
  document.querySelectorAll('.cred-row').forEach(row => {
    const domain   = row.querySelector('.cred-domain').value.trim();
    const email    = row.querySelector('.cred-email').value.trim();
    const username = row.querySelector('.cred-user').value.trim();
    const password = row.querySelector('.cred-pass').value;
    if (domain) overrides.push({ domain, email, username, password });
  });
  return { default: def, overrides };
}

document.getElementById('add-cred-override').addEventListener('click', () => addCredOverrideRow());

document.getElementById('save-cred').addEventListener('click', () => {
  const cred = collectCredentials();
  chrome.storage.local.set({ atsCredentials: cred }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('cred-saved');
    }
  });
});

// ── Custom Q&A pair management ───────────────────────────────────────────
function loadCustomQA() {
  chrome.storage.local.get(['customQA'], r => {
    const list = document.getElementById('custom-qa-list');
    list.innerHTML = '';
    const pairs = r.customQA || [];
    pairs.forEach(pair => addCustomQARow(pair.question, pair.answer));
  });
}

function addCustomQARow(question = '', answer = '') {
  const list = document.getElementById('custom-qa-list');
  const row = document.createElement('div');
  row.className = 'custom-qa-row';
  row.innerHTML = `
    <div class="field">
      <label class="field-label">Question / Label Text</label>
      <input class="field-input custom-qa-q" type="text" value="${escapeHtml(question)}" placeholder="e.g. How did you hear about us?">
    </div>
    <div class="field">
      <label class="field-label">Answer</label>
      <input class="field-input custom-qa-a" type="text" value="${escapeHtml(answer)}" placeholder="e.g. LinkedIn">
    </div>
    <button class="custom-qa-remove" title="Remove">✕</button>
  `;
  row.querySelector('.custom-qa-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectCustomQA() {
  const rows = document.querySelectorAll('.custom-qa-row');
  const pairs = [];
  rows.forEach(row => {
    const q = row.querySelector('.custom-qa-q').value.trim();
    const a = row.querySelector('.custom-qa-a').value.trim();
    if (q || a) pairs.push({ question: q, answer: a });
  });
  return pairs;
}

document.getElementById('add-custom-qa').addEventListener('click', () => addCustomQARow());

document.getElementById('save-custom-qa').addEventListener('click', () => {
  const pairs = collectCustomQA();
  chrome.storage.local.set({ customQA: pairs }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('custom-qa-saved');
    }
  });
});

// ── Work Experience management ──────────────────────────────────────────
function getExpResumeTypes() {
  // Use currently loaded job types for experience tabs
  return currentJobTypes.length > 0
    ? currentJobTypes.map(jt => ({ key: jt.key, label: `${jt.emoji} ${jt.label}` }))
    : DEFAULT_JOB_TYPES.map(jt => ({ key: jt.key, label: `${jt.emoji} ${jt.label}` }));
}

function loadExperience() {
  chrome.storage.local.get(['workExperience'], r => {
    const list = document.getElementById('exp-list');
    list.innerHTML = '';
    const entries = r.workExperience || [];
    entries.forEach((exp, i) => addExpEntry(exp, i));
  });
}

function monthOptions(selected) {
  return '<option value="">--</option>' +
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      .map((m, i) => `<option value="${i + 1}" ${selected == (i+1) ? 'selected' : ''}>${m}</option>`)
      .join('');
}

function addExpEntry(exp = {}, index) {
  const list = document.getElementById('exp-list');
  const num = index !== undefined ? index + 1 : list.children.length + 1;
  const entry = document.createElement('div');
  entry.className = 'exp-entry';

  const resumeTypes = getExpResumeTypes();
  const variants = exp.variants || {};

  const tabButtons = resumeTypes.map((rt, i) =>
    `<button class="exp-tab-btn ${i === 0 ? 'active' : ''}" data-rt="${rt.key}">${rt.label}</button>`
  ).join('');

  const tabPanels = resumeTypes.map((rt, i) => {
    const v = variants[rt.key] || {};
    return `<div class="exp-tab-panel ${i === 0 ? '' : 'exp-tab-hidden'}" data-rt="${rt.key}">
      <div class="exp-grid">
        <div class="field full">
          <label class="field-label">Job Title (${rt.label})</label>
          <input class="field-input exp-var-title" data-rt="${rt.key}" type="text" value="${escapeHtml(v.title || exp.title || '')}" placeholder="Title as it appears on this resume">
        </div>
        <div class="field full">
          <label class="field-label">Description (${rt.label})</label>
          <textarea class="field-textarea exp-var-desc" data-rt="${rt.key}" placeholder="Tailor responsibilities for this resume type...">${escapeHtml(v.description || exp.description || '')}</textarea>
        </div>
      </div>
    </div>`;
  }).join('');

  entry.innerHTML = `
    <div class="exp-header">
      <div class="exp-number">${num}</div>
      ${exp.current ? '<span class="exp-current-badge">Current</span>' : ''}
    </div>
    <button class="exp-remove" title="Remove">✕</button>
    <div class="exp-grid">
      <div class="field">
        <label class="field-label">Company</label>
        <input class="field-input exp-company" type="text" value="${escapeHtml(exp.company || '')}" placeholder="e.g. Acme Corp">
      </div>
      <div class="field">
        <label class="field-label">Location</label>
        <input class="field-input exp-location" type="text" value="${escapeHtml(exp.location || '')}" placeholder="e.g. Fort Lauderdale, FL">
      </div>
      <div class="field full">
        <label class="field-label">Start / End Date</label>
        <div class="exp-date-row">
          <div class="field">
            <select class="field-select exp-start-month">${monthOptions(exp.startMonth)}</select>
          </div>
          <div class="field">
            <input class="field-input exp-start-year" type="text" value="${escapeHtml(exp.startYear || '')}" placeholder="Year" style="width:70px">
          </div>
          <span style="color:var(--text3);padding-bottom:8px;">→</span>
          <div class="field">
            <select class="field-select exp-end-month" ${exp.current ? 'disabled' : ''}>${monthOptions(exp.endMonth)}</select>
          </div>
          <div class="field">
            <input class="field-input exp-end-year" type="text" value="${escapeHtml(exp.endYear || '')}" placeholder="Year" style="width:70px" ${exp.current ? 'disabled' : ''}>
          </div>
          <label class="exp-current-check">
            <input type="checkbox" class="exp-current" ${exp.current ? 'checked' : ''}> Current
          </label>
        </div>
      </div>
    </div>
    <div class="exp-tabs" style="margin-top:12px">
      <div class="exp-tab-bar">${tabButtons}</div>
      ${tabPanels}
    </div>
  `;

  // Tab switching
  entry.querySelectorAll('.exp-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const rt = btn.dataset.rt;
      entry.querySelectorAll('.exp-tab-btn').forEach(b => b.classList.remove('active'));
      entry.querySelectorAll('.exp-tab-panel').forEach(p => p.classList.add('exp-tab-hidden'));
      btn.classList.add('active');
      entry.querySelector(`.exp-tab-panel[data-rt="${rt}"]`).classList.remove('exp-tab-hidden');
    });
  });

  // Copy-down: when the first tab's title/desc changes, auto-fill empty tabs
  const firstRT = resumeTypes[0]?.key;
  if (firstRT) {
    const firstTitle = entry.querySelector(`.exp-var-title[data-rt="${firstRT}"]`);
    const firstDesc  = entry.querySelector(`.exp-var-desc[data-rt="${firstRT}"]`);
    if (firstTitle) {
      firstTitle.addEventListener('blur', () => {
        entry.querySelectorAll('.exp-var-title').forEach(inp => {
          if (inp !== firstTitle && !inp.value.trim()) inp.value = firstTitle.value;
        });
      });
    }
    if (firstDesc) {
      firstDesc.addEventListener('blur', () => {
        entry.querySelectorAll('.exp-var-desc').forEach(inp => {
          if (inp !== firstDesc && !inp.value.trim()) inp.value = firstDesc.value;
        });
      });
    }
  }

  entry.querySelector('.exp-remove').addEventListener('click', () => entry.remove());
  entry.querySelector('.exp-current').addEventListener('change', (e) => {
    const endMonth = entry.querySelector('.exp-end-month');
    const endYear = entry.querySelector('.exp-end-year');
    if (e.target.checked) {
      endMonth.disabled = true; endMonth.value = '';
      endYear.disabled = true; endYear.value = '';
    } else {
      endMonth.disabled = false;
      endYear.disabled = false;
    }
  });

  list.appendChild(entry);
}

function collectExperience() {
  const resumeTypes = getExpResumeTypes();
  const entries = [];
  document.querySelectorAll('.exp-entry').forEach(entry => {
    const company    = entry.querySelector('.exp-company').value.trim();
    const location   = entry.querySelector('.exp-location').value.trim();
    const startMonth = entry.querySelector('.exp-start-month').value;
    const startYear  = entry.querySelector('.exp-start-year').value.trim();
    const endMonth   = entry.querySelector('.exp-end-month').value;
    const endYear    = entry.querySelector('.exp-end-year').value.trim();
    const current    = entry.querySelector('.exp-current').checked;

    const variants = {};
    resumeTypes.forEach(rt => {
      const titleEl = entry.querySelector(`.exp-var-title[data-rt="${rt.key}"]`);
      const descEl  = entry.querySelector(`.exp-var-desc[data-rt="${rt.key}"]`);
      variants[rt.key] = {
        title:       titleEl ? titleEl.value.trim() : '',
        description: descEl  ? descEl.value.trim()  : '',
      };
    });

    const title = Object.values(variants).find(v => v.title)?.title || '';
    const description = Object.values(variants).find(v => v.description)?.description || '';

    if (title || company) {
      entries.push({ title, company, location, startMonth, startYear, endMonth, endYear, current, description, variants });
    }
  });
  return entries;
}

document.getElementById('add-exp').addEventListener('click', () => addExpEntry({}, document.querySelectorAll('.exp-entry').length));

document.getElementById('save-exp').addEventListener('click', () => {
  const exp = collectExperience();
  chrome.storage.local.set({ workExperience: exp }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('exp-saved');
    }
  });
});

// ── Claude CLI server config ────────────────────────────────────────────
function loadClaudeConfig() {
  chrome.storage.local.get(['claudeServerPort'], r => {
    document.getElementById('claude-server-port').value = r.claudeServerPort || 3847;
  });
  checkClaudeServer();
}

async function checkClaudeServer() {
  const statusEl = document.getElementById('claude-server-status');
  const port = document.getElementById('claude-server-port').value || 3847;
  statusEl.textContent = 'Checking...';
  statusEl.className = 'claude-status checking';
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'claude-status connected';
    } else {
      statusEl.textContent = 'Not running';
      statusEl.className = 'claude-status disconnected';
    }
  } catch (e) {
    statusEl.textContent = 'Not running';
    statusEl.className = 'claude-status disconnected';
  }
}

document.getElementById('save-claude-config').addEventListener('click', () => {
  const port = parseInt(document.getElementById('claude-server-port').value) || 3847;
  chrome.storage.local.set({ claudeServerPort: port }, () => {
    showSaved('claude-saved');
    checkClaudeServer();
  });
});

document.getElementById('check-claude-server').addEventListener('click', checkClaudeServer);

// ── Save handlers ──────────────────────────────────────────────────────────
document.getElementById('save-profile').addEventListener('click', () => {
  const profile = {
    name:     document.getElementById('name').value.trim(),
    email:    document.getElementById('email').value.trim(),
    phone:    document.getElementById('phone').value.trim(),
    street:   document.getElementById('street').value.trim(),
    city:     document.getElementById('city').value.trim(),
    state:    document.getElementById('state').value.trim(),
    zip:      document.getElementById('zip').value.trim(),
    country:  document.getElementById('country').value.trim(),
    location: (document.getElementById('city').value.trim() + ', ' + document.getElementById('state').value.trim()).replace(/^,\s*|,\s*$/g, ''),
    linkedin: document.getElementById('linkedin').value.trim(),
    title:    document.getElementById('title').value.trim(),
    summary:  document.getElementById('summary').value.trim(),
  };
  chrome.storage.local.set({ profile }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('profile-saved');
      updateAvatar(profile.name);
    }
  });
});

document.getElementById('save-qa').addEventListener('click', () => {
  const answers = {};
  for (const key of QA_FIELDS) {
    const el = document.getElementById(`qa-${key}`);
    if (el) answers[key] = el.value.trim();
  }
  chrome.storage.local.set({ qaAnswers: answers }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('qa-saved');
    }
  });
});

// ── Name → avatar live preview ───────────────────────────────────────────────
document.getElementById('name').addEventListener('input', e => {
  updateAvatar(e.target.value);
});

// ── Open dashboard ───────────────────────────────────────────────────────────
const dashLink = document.getElementById('open-dashboard');
if (dashLink) {
  dashLink.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
loadJobTypes();
loadCredentials();
loadExperience();
loadCustomQA();
loadClaudeConfig();
