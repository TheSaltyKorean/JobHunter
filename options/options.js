// JobHunter Options Page

const PROFILE_FIELDS = [
  'firstName','lastName','email','phone','address','city','state','zip','country',
  'linkedin','github','website','currentTitle','yearsExperience',
  'salaryExpectation','salaryMin','workAuthorization','requireSponsorship',
  'coverLetterDefault','gender','ethnicity','veteran','disability'
];

const SETTINGS_FIELDS = ['autoDetect','highlightFilled','showBadge'];

document.addEventListener('DOMContentLoaded', async () => {
  await loadProfile();
  await loadSettings();
  bindUI();
});

async function loadProfile() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
  const profile = res?.data || {};
  PROFILE_FIELDS.forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    el.value = profile[key] || '';
  });
}

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const settings = res?.data || {};
  SETTINGS_FIELDS.forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = settings[key] !== false; // default true
    } else {
      el.value = settings[key] || '';
    }
  });
}

async function saveAll() {
  // Build profile
  const profile = {};
  PROFILE_FIELDS.forEach(key => {
    const el = document.getElementById(key);
    if (el) profile[key] = el.value;
  });

  // Build settings
  const settings = {};
  SETTINGS_FIELDS.forEach(key => {
    const el = document.getElementById(key);
    if (el) settings[key] = el.type === 'checkbox' ? el.checked : el.value;
  });

  await chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', profile });
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });

  showToast('✅ Profile saved!');
}

async function clearAll() {
  if (!confirm('This will delete ALL your tracked jobs and reset your profile.\n\nAre you sure?')) return;
  await chrome.storage.local.clear();
  showToast('🗑 All data cleared');
  setTimeout(() => location.reload(), 1200);
}

function bindUI() {
  document.getElementById('save-btn').addEventListener('click', saveAll);
  document.getElementById('open-dashboard').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });
  document.getElementById('open-dashboard-2').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });
  document.getElementById('clear-all').addEventListener('click', clearAll);

  // Save on Enter in inputs
  document.querySelectorAll('.field-input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveAll();
    });
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}
