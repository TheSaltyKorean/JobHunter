// JobHunter — Options Page
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RESUMES = {
  cloud:     'Cloud & Infrastructure Resume',
  'it-mgmt': 'IT Management Resume',
  executive: 'Executive Resume',
  staffing:  'Staffing Agency Resume',
};

// ── Load saved data into form ─────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(['profile', 'resumeNames'], r => {
    const p = r.profile || {};
    const rn = { ...DEFAULT_RESUMES, ...(r.resumeNames || {}) };

    // Profile fields
    document.getElementById('name').value       = p.name       || '';
    document.getElementById('email').value      = p.email      || '';
    document.getElementById('phone').value      = p.phone      || '';
    document.getElementById('location').value   = p.location   || '';
    document.getElementById('linkedin').value   = p.linkedin   || '';
    document.getElementById('title').value      = p.title      || '';
    document.getElementById('summary').value    = p.summary    || '';

    // Resume name fields
    document.getElementById('resume-cloud').value     = rn['cloud'];
    document.getElementById('resume-it-mgmt').value   = rn['it-mgmt'];
    document.getElementById('resume-executive').value = rn['executive'];
    document.getElementById('resume-staffing').value  = rn['staffing'];

    // Update avatar
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

function showSaved(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// ── Name field → avatar live preview ─────────────────────────────────────────
document.getElementById('name').addEventListener('input', e => {
  updateAvatar(e.target.value);
});

// ── Open dashboard link ───────────────────────────────────────────────────────
const dashLink = document.getElementById('open-dashboard');
if (dashLink) {
  dashLink.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
