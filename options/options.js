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
loadCustomQA();
loadClaudeConfig();
