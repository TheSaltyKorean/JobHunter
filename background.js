// JobHunter — Background Service Worker
// ─── Init ──────────────────────────────────────────────────────────────────

const DEFAULT_RESUMES = {
  cloud:     'Cloud & Infrastructure Resume',
  'it-mgmt': 'IT Management Resume',
  executive: 'Executive Resume',
  staffing:  'Staffing Agency Resume',
};

// Default answers for common application questions
const DEFAULT_QA = {
  yearsExperience:    '',
  workAuthorization:  'Authorized to work in the US',
  sponsorship:        'No',
  willingToRelocate:  'Yes',
  desiredSalary:      '',
  startDate:          'Immediately',
  veteranStatus:      'I am not a protected veteran',
  disabilityStatus:   'I do not wish to answer',
  gender:             'I do not wish to answer',
  ethnicity:          'I do not wish to answer',
  educationLevel:     '',
  university:         '',
  graduationYear:     '',
  linkedinUrl:        '',
  githubUrl:          '',
  websiteUrl:         '',
};

// ─── Job Type Detection ─────────────────────────────────────────────────────

const STAFFING_FIRMS = [
  'infosys','wipro','tcs','tata consultancy','hcl','cognizant','tech mahindra',
  'capgemini','syntel','hexaware','mphasis','ltimindtree','mindtree','niit',
  'igate','mastech','persistent','virtusa','zensar','birlasoft','cyient',
  'kforce','apex','collabera','diverse lynx','genesis10','softpath','incedo',
  'trigent','datamatics','inforeliance','xorbit','geotemps','staffmark',
  'pvh tech','tekskills','suncap','intellectt','technocraft',
];

const EXECUTIVE_KEYWORDS = [
  'vp ','vice president','cto','cio','ciso','cxo','svp','evp',
  'chief information','chief technology','chief digital','chief data',
  'managing director','global head','head of it','head of technology',
  'president of','group director','it director',
];

const CLOUD_KEYWORDS = [
  'cloud','aws','azure','gcp','google cloud','infrastructure','devops',
  'site reliability','sre','platform engineer','kubernetes','k8s','terraform',
  'ansible','datacenter','data center','network engineer','systems engineer',
  'cloud architect','solutions architect','cloud operations','cloudops',
  'vmware','virtualization','devsecops','mlops','finops','cloud security',
];

function detectJobType(title, company) {
  const t = (title  || '').toLowerCase();
  const c = (company || '').toLowerCase();

  if (STAFFING_FIRMS.some(f => c.includes(f))) return 'staffing';
  if (EXECUTIVE_KEYWORDS.some(k => t.includes(k))) return 'executive';
  if (CLOUD_KEYWORDS.some(k => t.includes(k))) return 'cloud';
  return 'it-mgmt';
}

async function getResumeNames() {
  return new Promise(resolve => {
    chrome.storage.local.get(['resumeNames'], r => {
      resolve({ ...DEFAULT_RESUMES, ...(r.resumeNames || {}) });
    });
  });
}

async function getProfile() {
  return new Promise(resolve => {
    chrome.storage.local.get(['profile'], r => resolve(r.profile || {}));
  });
}

async function getQAAnswers() {
  return new Promise(resolve => {
    chrome.storage.local.get(['qaAnswers'], r => {
      resolve({ ...DEFAULT_QA, ...(r.qaAnswers || {}) });
    });
  });
}

async function getResumeFile(type) {
  return new Promise(resolve => {
    chrome.storage.local.get([`resumeFile_${type}`], r => {
      resolve(r[`resumeFile_${type}`] || null);
    });
  });
}

// ─── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Save job ──────────────────────────────────────────────────────────────
  if (msg.type === 'SAVE_JOB') {
    chrome.storage.local.get(['jobs'], async r => {
      const jobs = r.jobs || [];
      const url = msg.job.url || '';
      if (url && jobs.some(j => j.url === url)) {
        sendResponse({ ok: false, reason: 'duplicate' });
        return;
      }

      const resumeNames = await getResumeNames();
      const jobType     = msg.job.jobType || detectJobType(msg.job.title, msg.job.company);
      const resumeUsed  = msg.job.resumeUsed || resumeNames[jobType] || resumeNames['it-mgmt'];

      const job = {
        id:          crypto.randomUUID(),
        title:       msg.job.title    || '',
        company:     msg.job.company  || '',
        location:    msg.job.location || '',
        platform:    msg.job.platform || '',
        url:         url,
        status:      msg.job.status   || 'saved',
        jobType,
        resumeUsed,
        notes:       msg.job.notes    || '',
        salary:      msg.job.salary   || '',
        savedAt:     Date.now(),
      };

      jobs.push(job);
      chrome.storage.local.set({ jobs }, () => {
        sendResponse({ ok: true, job });
      });
    });
    return true;
  }

  // ── Suggest resume for a job type ─────────────────────────────────────────
  if (msg.type === 'SUGGEST_RESUME') {
    (async () => {
      const resumeNames = await getResumeNames();
      const jobType     = msg.jobType || detectJobType(msg.title, msg.company);
      sendResponse({ jobType, resumeName: resumeNames[jobType], resumeNames });
    })();
    return true;
  }

  // ── Get resume names ──────────────────────────────────────────────────────
  if (msg.type === 'GET_RESUME_NAMES') {
    (async () => { sendResponse(await getResumeNames()); })();
    return true;
  }

  // ── Get resume file (base64 PDF) ──────────────────────────────────────────
  if (msg.type === 'GET_RESUME_FILE') {
    (async () => {
      const file = await getResumeFile(msg.resumeType);
      sendResponse(file);
    })();
    return true;
  }

  // ── Save resume file (base64 PDF) ─────────────────────────────────────────
  if (msg.type === 'SAVE_RESUME_FILE') {
    const key = `resumeFile_${msg.resumeType}`;
    const data = {
      name:     msg.fileName,
      size:     msg.fileSize,
      data:     msg.fileData,    // base64 string
      mimeType: 'application/pdf',
      savedAt:  Date.now(),
    };
    chrome.storage.local.set({ [key]: data }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Delete resume file ────────────────────────────────────────────────────
  if (msg.type === 'DELETE_RESUME_FILE') {
    chrome.storage.local.remove(`resumeFile_${msg.resumeType}`, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Get all resume file info (not data — just metadata) ───────────────────
  if (msg.type === 'GET_RESUME_FILES_INFO') {
    chrome.storage.local.get(null, r => {
      const info = {};
      for (const type of ['cloud', 'it-mgmt', 'executive', 'staffing']) {
        const file = r[`resumeFile_${type}`];
        if (file) {
          info[type] = { name: file.name, size: file.size, savedAt: file.savedAt };
        }
      }
      sendResponse(info);
    });
    return true;
  }

  // ── Get profile ───────────────────────────────────────────────────────────
  if (msg.type === 'GET_PROFILE') {
    (async () => { sendResponse(await getProfile()); })();
    return true;
  }

  // ── Get Q&A answers ───────────────────────────────────────────────────────
  if (msg.type === 'GET_QA_ANSWERS') {
    (async () => { sendResponse(await getQAAnswers()); })();
    return true;
  }

  // ── Save Q&A answers ──────────────────────────────────────────────────────
  if (msg.type === 'SAVE_QA_ANSWERS') {
    chrome.storage.local.set({ qaAnswers: msg.answers }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Get auto-fill data bundle (profile + Q&A + resume file) ───────────────
  if (msg.type === 'GET_AUTOFILL_DATA') {
    (async () => {
      const profile     = await getProfile();
      const qa          = await getQAAnswers();
      const resumeNames = await getResumeNames();
      const resumeFile  = await getResumeFile(msg.resumeType || 'it-mgmt');
      sendResponse({ profile, qa, resumeNames, resumeFile });
    })();
    return true;
  }

  // ── Update job ────────────────────────────────────────────────────────────
  if (msg.type === 'UPDATE_JOB') {
    chrome.storage.local.get(['jobs'], r => {
      const jobs = (r.jobs || []).map(j =>
        j.id === msg.job.id ? { ...j, ...msg.job } : j
      );
      chrome.storage.local.set({ jobs }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // ── Delete job ────────────────────────────────────────────────────────────
  if (msg.type === 'DELETE_JOB') {
    chrome.storage.local.get(['jobs'], r => {
      const jobs = (r.jobs || []).filter(j => j.id !== msg.id);
      chrome.storage.local.set({ jobs }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // ── Get all jobs ──────────────────────────────────────────────────────────
  if (msg.type === 'GET_JOBS') {
    chrome.storage.local.get(['jobs'], r => {
      sendResponse({ jobs: r.jobs || [] });
    });
    return true;
  }

  // ── Open dashboard / settings ──────────────────────────────────────────────
  if (msg.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    return false;
  }
  if (msg.type === 'OPEN_SETTINGS') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  // ── Toggle sidebar visibility (from popup) ────────────────────────────────
  if (msg.type === 'TOGGLE_SIDEBAR') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_SIDEBAR' });
      }
    });
    return false;
  }
});

// ─── Extension install / update ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['jobs', 'resumeNames', 'qaAnswers'], r => {
    const updates = {};
    if (!r.jobs)        updates.jobs        = [];
    if (!r.resumeNames) updates.resumeNames = DEFAULT_RESUMES;
    if (!r.qaAnswers)   updates.qaAnswers   = DEFAULT_QA;
    if (Object.keys(updates).length) chrome.storage.local.set(updates);
  });
});

// ── Keyboard shortcut to toggle sidebar ─────────────────────────────────────
chrome.commands?.onCommand?.addListener(command => {
  if (command === 'toggle-sidebar') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_SIDEBAR' });
      }
    });
  }
});
