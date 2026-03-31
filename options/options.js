// JobHunter — Options Page
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RESUMES = {
  cloud:     'Cloud & Infrastructure Resume',
  'it-mgmt': 'IT Management Resume',
  executive: 'Executive Resume',
  staffing:  'Staffing Agency Resume',
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
    const qa = r.qaAnswers || {};

    // Profile fields
    document.getElementById('name').value     = p.name     || '';
    document.getElementById('email').value    = p.email    || '';
    document.getElementById('phone').value    = p.phone    || '';
    document.getElementById('location').value = p.location || '';
    document.getElementById('linkedin').value = p.linkedin || '';
    document.getElementById('title').value    = p.title    || '';
    document.getElementById('summary').value  = p.summary  || '';

    // Resume name fields
    document.getElementById('resume-cloud').value     = rn['cloud'];
    document.getElementById('resume-it-mgmt').value   = rn['it-mgmt'];
    document.getElementById('resume-executive').value = rn['executive'];
    document.getElementById('resume-staffing').value  = rn['staffing'];

    // Q&A fields
    for (const key of QA_FIELDS) {
      const el = document.getElementById(`qa-${key}`);
      if (el && qa[key]) {
        el.value = qa[key];
      }
    }

    updateAvatar(p.name || '');
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

// ── Resume file detection (reads from resumes/ folder) ──────────────────────
function loadResumeFiles() {
  chrome.runtime.sendMessage({ type: 'GET_RESUME_FILES_INFO' }, info => {
    if (!info) info = {};
    for (const type of RESUME_TYPES) {
      const nameEl   = document.getElementById(`file-name-${type}`);
      const statusEl = document.getElementById(`file-status-${type}`);
      if (info[type]) {
        nameEl.textContent = `${type}.pdf (${formatSize(info[type].size)})`;
        nameEl.classList.remove('no-file');
        statusEl.textContent = 'Found';
        statusEl.className = 'resume-file-status found';
      } else {
        nameEl.textContent = `${type}.pdf not found in resumes/ folder`;
        nameEl.classList.add('no-file');
        statusEl.textContent = 'Missing';
        statusEl.className = 'resume-file-status missing';
      }
    }
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Custom Q&A pair management ───────────────────────────────────────────
function loadCustomQA() {
  chrome.runtime.sendMessage({ type: 'GET_CUSTOM_QA' }, pairs => {
    const list = document.getElementById('custom-qa-list');
    list.innerHTML = '';
    (pairs || []).forEach(pair => addCustomQARow(pair.question, pair.answer));
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

document.getElementById('save-custom-qa').addEventListener('click', () => {
  const pairs = collectCustomQA();
  chrome.runtime.sendMessage({ type: 'SAVE_CUSTOM_QA', pairs }, resp => {
    if (resp?.ok) showSaved('custom-qa-saved');
  });
});

// ── Claude API key management ───────────────────────────────────────────
function loadClaudeKey() {
  chrome.runtime.sendMessage({ type: 'GET_CLAUDE_API_KEY' }, resp => {
    if (resp?.key) {
      document.getElementById('claude-api-key').value = resp.key;
    }
  });
}

document.getElementById('save-claude-key').addEventListener('click', () => {
  const key = document.getElementById('claude-api-key').value.trim();
  chrome.runtime.sendMessage({ type: 'SAVE_CLAUDE_API_KEY', key }, resp => {
    if (resp?.ok) showSaved('claude-saved');
  });
});

// ── Save handlers ─────────────────────────────────────────────────────────────
document.getElementById('save-profile').addEventListener('click', () => {
  const profile = {
    name:     document.getElementById('name').value.trim(),
    email:    document.getElementById('email').value.trim(),
    phone:    document.getElementById('phone').value.trim(),
    location: document.getElementById('location').value.trim(),
    linkedin: document.getElementById('linkedin').value.trim(),
    title:    document.getElementById('title').value.trim(),
    summary:  document.getElementById('summary').value.trim(),
  };
  chrome.storage.local.set({ profile }, () => {
    showSaved('profile-saved');
    updateAvatar(profile.name);
  });
});

document.getElementById('save-resumes').addEventListener('click', () => {
  const resumeNames = {
    cloud:     document.getElementById('resume-cloud').value.trim()     || DEFAULT_RESUMES.cloud,
    'it-mgmt': document.getElementById('resume-it-mgmt').value.trim()   || DEFAULT_RESUMES['it-mgmt'],
    executive: document.getElementById('resume-executive').value.trim() || DEFAULT_RESUMES.executive,
    staffing:  document.getElementById('resume-staffing').value.trim()  || DEFAULT_RESUMES.staffing,
  };
  chrome.storage.local.set({ resumeNames }, () => showSaved('resumes-saved'));
});

document.getElementById('save-qa').addEventListener('click', () => {
  const answers = {};
  for (const key of QA_FIELDS) {
    const el = document.getElementById(`qa-${key}`);
    if (el) answers[key] = el.value.trim();
  }
  chrome.runtime.sendMessage({ type: 'SAVE_QA_ANSWERS', answers }, resp => {
    if (resp?.ok) showSaved('qa-saved');
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
loadCustomQA();
loadClaudeKey();
