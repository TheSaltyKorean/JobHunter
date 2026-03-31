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

  // Load resume file info
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

// ── Resume file management ───────────────────────────────────────────────────
function loadResumeFiles() {
  chrome.runtime.sendMessage({ type: 'GET_RESUME_FILES_INFO' }, info => {
    if (!info) return;
    for (const type of RESUME_TYPES) {
      const nameEl = document.getElementById(`file-name-${type}`);
      const delBtn = document.getElementById(`file-del-${type}`);
      if (info[type]) {
        nameEl.textContent = `${info[type].name} (${formatSize(info[type].size)})`;
        nameEl.classList.remove('no-file');
        delBtn.style.display = '';
      } else {
        nameEl.textContent = 'No file uploaded';
        nameEl.classList.add('no-file');
        delBtn.style.display = 'none';
      }
    }
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Wire up upload buttons
for (const type of RESUME_TYPES) {
  const uploadBtn = document.getElementById(`file-btn-${type}`);
  const fileInput = document.getElementById(`file-input-${type}`);
  const deleteBtn = document.getElementById(`file-del-${type}`);

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please upload a PDF file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File too large. Maximum size is 5 MB.');
      return;
    }

    uploadBtn.textContent = 'Uploading...';
    uploadBtn.disabled = true;

    // Read file as base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]; // strip data:...;base64, prefix
      chrome.runtime.sendMessage({
        type: 'SAVE_RESUME_FILE',
        resumeType: type,
        fileName:   file.name,
        fileSize:   file.size,
        fileData:   base64,
      }, resp => {
        uploadBtn.textContent = 'Upload';
        uploadBtn.disabled = false;
        if (resp?.ok) {
          loadResumeFiles();
          showSaved('resumes-saved');
        } else {
          alert('Upload failed. Try again.');
        }
      });
    };
    reader.readAsDataURL(file);
  });

  deleteBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DELETE_RESUME_FILE', resumeType: type }, () => {
      loadResumeFiles();
    });
  });
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
