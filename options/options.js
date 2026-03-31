// JobHunter — Options Page
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RESUMES = {
  cloud:     'Cloud & Infrastructure Resume',
  'it-mgmt': 'IT Management Resume',
  executive: 'Executive Resume',
  staffing:  'Staffing Agency Resume',
};

const DEFAULT_QA = {
  yearsExperience: '', workAuthorization: 'Authorized to work in the US',
  sponsorship: 'No', willingToRelocate: 'Yes', desiredSalary: '',
  startDate: 'Immediately', veteranStatus: 'I am not a protected veteran',
  disabilityStatus: 'I do not wish to answer', gender: 'I do not wish to answer',
  ethnicity: 'I do not wish to answer', educationLevel: '', university: '',
  graduationYear: '', linkedinUrl: '', githubUrl: '', websiteUrl: '',
};

const RESUME_TYPES = ['cloud', 'it-mgmt', 'executive', 'staffing'];

const QA_FIELDS = [
  'yearsExperience', 'workAuthorization', 'sponsorship', 'willingToRelocate',
  'desiredSalary', 'startDate', 'veteranStatus', 'disabilityStatus',
  'gender', 'ethnicity', 'educationLevel', 'university', 'graduationYear',
  'linkedinUrl', 'githubUrl', 'websiteUrl',
];

// ── Load saved data into form ─────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(['profile', 'resumeNames', 'qaAnswers'], r => {
    const p  = r.profile || {};
    const rn = { ...DEFAULT_RESUMES, ...(r.resumeNames || {}) };
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

    // Resume name fields
    document.getElementById('resume-cloud').value     = rn['cloud'];
    document.getElementById('resume-it-mgmt').value   = rn['it-mgmt'];
    document.getElementById('resume-executive').value = rn['executive'];
    document.getElementById('resume-staffing').value  = rn['staffing'];

    // Q&A fields — use merged defaults so saved values always load
    for (const key of QA_FIELDS) {
      const el = document.getElementById(`qa-${key}`);
      if (el && qa[key] !== undefined) {
        el.value = qa[key];
      }
    }

    updateAvatar(p.name || '');
    console.log('JobHunter Options: loaded QA answers', qa);
  });

  // Load resume file status
  loadResumeFiles();
}

function updateAvatar(name) {
  const el = document.getElementById('avatar-preview');
  if (!el) return;
  const parts = (name || '').trim().split(/\s+/);
  el.textContent = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0]?.[0] || '?').toUpperCase();
}

// ── Resume file detection (checks directly via fetch) ───────────────────────
async function loadResumeFiles() {
  for (const type of RESUME_TYPES) {
    const nameEl   = document.getElementById(`file-name-${type}`);
    const statusEl = document.getElementById(`file-status-${type}`);
    try {
      const url = chrome.runtime.getURL(`resumes/${type}.pdf`);
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.size > 100 && blob.type !== 'text/html') {
          nameEl.textContent = `${type}.pdf (${formatSize(blob.size)})`;
          nameEl.classList.remove('no-file');
          statusEl.textContent = 'Found';
          statusEl.className = 'resume-file-status found';
          continue;
        }
      }
    } catch (e) {
      console.warn(`JobHunter: Error checking ${type}.pdf:`, e);
    }
    nameEl.textContent = `${type}.pdf — not found in resumes/ folder`;
    nameEl.classList.add('no-file');
    statusEl.textContent = 'Missing';
    statusEl.className = 'resume-file-status missing';
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Custom Q&A pair management ───────────────────────────────────────────
function loadCustomQA() {
  chrome.storage.local.get(['customQA'], r => {
    const list = document.getElementById('custom-qa-list');
    list.innerHTML = '';
    const pairs = r.customQA || [];
    console.log('JobHunter Options: loaded custom QA', pairs);
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

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// Save custom Q&A — use chrome.storage.local DIRECTLY (no message passing)
document.getElementById('save-custom-qa').addEventListener('click', () => {
  const pairs = collectCustomQA();
  chrome.storage.local.set({ customQA: pairs }, () => {
    if (chrome.runtime.lastError) {
      console.error('Custom QA save error:', chrome.runtime.lastError);
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      console.log('JobHunter: Custom QA saved directly', pairs);
      showSaved('custom-qa-saved');
    }
  });
});

// ── Work Experience management ──────────────────────────────────────────
const EXP_RESUME_TYPES = [
  { key: 'cloud',     label: '☁️ Cloud & Infra' },
  { key: 'it-mgmt',   label: '💼 IT Mgmt' },
  { key: 'executive', label: '🏆 Executive' },
  { key: 'staffing',  label: '🏢 Staffing' },
];

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

  // Build per-resume-type tabs for title/description
  const variants = exp.variants || {};
  const tabButtons = EXP_RESUME_TYPES.map((rt, i) =>
    `<button class="exp-tab-btn ${i === 0 ? 'active' : ''}" data-rt="${rt.key}">${rt.label}</button>`
  ).join('');
  const tabPanels = EXP_RESUME_TYPES.map((rt, i) => {
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
  const firstTitle = entry.querySelector('.exp-var-title[data-rt="cloud"]');
  const firstDesc  = entry.querySelector('.exp-var-desc[data-rt="cloud"]');
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
  const entries = [];
  document.querySelectorAll('.exp-entry').forEach(entry => {
    const company    = entry.querySelector('.exp-company').value.trim();
    const location   = entry.querySelector('.exp-location').value.trim();
    const startMonth = entry.querySelector('.exp-start-month').value;
    const startYear  = entry.querySelector('.exp-start-year').value.trim();
    const endMonth   = entry.querySelector('.exp-end-month').value;
    const endYear    = entry.querySelector('.exp-end-year').value.trim();
    const current    = entry.querySelector('.exp-current').checked;

    // Collect per-resume-type variants
    const variants = {};
    EXP_RESUME_TYPES.forEach(rt => {
      const titleEl = entry.querySelector(`.exp-var-title[data-rt="${rt.key}"]`);
      const descEl  = entry.querySelector(`.exp-var-desc[data-rt="${rt.key}"]`);
      variants[rt.key] = {
        title:       titleEl ? titleEl.value.trim() : '',
        description: descEl  ? descEl.value.trim()  : '',
      };
    });

    // Use cloud title as the default/legacy title
    const title = variants.cloud?.title || '';
    const description = variants.cloud?.description || '';

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

// ── ATS Login Credentials ───────────────────────────────────────────────
function loadCredentials() {
  chrome.storage.local.get(['atsCredentials', 'profile'], r => {
    const cred = r.atsCredentials || {};
    const profile = r.profile || {};
    document.getElementById('cred-email').value    = cred.email    || profile.email || '';
    document.getElementById('cred-username').value  = cred.username || '';
    document.getElementById('cred-password').value  = cred.password || '';
  });
}

document.getElementById('save-cred').addEventListener('click', () => {
  const cred = {
    email:    document.getElementById('cred-email').value.trim(),
    username: document.getElementById('cred-username').value.trim(),
    password: document.getElementById('cred-password').value,
  };
  chrome.storage.local.set({ atsCredentials: cred }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('cred-saved');
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

// ── Save handlers — all use chrome.storage.local DIRECTLY ────────────────────
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

document.getElementById('save-resumes').addEventListener('click', () => {
  const resumeNames = {
    cloud:     document.getElementById('resume-cloud').value.trim()     || DEFAULT_RESUMES.cloud,
    'it-mgmt': document.getElementById('resume-it-mgmt').value.trim()   || DEFAULT_RESUMES['it-mgmt'],
    executive: document.getElementById('resume-executive').value.trim() || DEFAULT_RESUMES.executive,
    staffing:  document.getElementById('resume-staffing').value.trim()  || DEFAULT_RESUMES.staffing,
  };
  chrome.storage.local.set({ resumeNames }, () => {
    if (chrome.runtime.lastError) {
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      showSaved('resumes-saved');
    }
  });
});

// Save Q&A — use chrome.storage.local DIRECTLY (no message passing)
document.getElementById('save-qa').addEventListener('click', () => {
  const answers = {};
  for (const key of QA_FIELDS) {
    const el = document.getElementById(`qa-${key}`);
    if (el) answers[key] = el.value.trim();
  }
  chrome.storage.local.set({ qaAnswers: answers }, () => {
    if (chrome.runtime.lastError) {
      console.error('QA save error:', chrome.runtime.lastError);
      alert('Save failed: ' + chrome.runtime.lastError.message);
    } else {
      console.log('JobHunter: QA saved directly', answers);
      showSaved('qa-saved');
    }
  });
});

function showSaved(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

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
loadCredentials();
loadExperience();
loadCustomQA();
loadClaudeConfig();
