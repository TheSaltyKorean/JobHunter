// JobHunter — Background Service Worker
// ─── Init ──────────────────────────────────────────────────────────────────

const DEFAULT_RESUMES = {
  cloud:     'Cloud & Infrastructure Resume',
  'it-mgmt': 'IT Management Resume',
  executive: 'Executive Resume',
  staffing:  'Staffing Agency Resume',
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

  // Staffing firms first — company name match
  if (STAFFING_FIRMS.some(f => c.includes(f))) return 'staffing';

  // Executive — title keywords
  if (EXECUTIVE_KEYWORDS.some(k => t.includes(k))) return 'executive';

  // Cloud / Infrastructure — title keywords
  if (CLOUD_KEYWORDS.some(k => t.includes(k))) return 'cloud';

  // Default: general IT management
  return 'it-mgmt';
}

async function getResumeNames() {
  return new Promise(resolve => {
    chrome.storage.local.get(['resumeNames'], r => {
      resolve({ ...DEFAULT_RESUMES, ...(r.resumeNames || {}) });
    });
  });
}

// ─── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Save job ──────────────────────────────────────────────────────────────
  if (msg.type === 'SAVE_JOB') {
    chrome.storage.local.get(['jobs'], async r => {
      const jobs = r.jobs || [];

      // Avoid duplicates by URL
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
    return true; // async
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
});

// ─── Extension install / update ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['jobs', 'resumeNames'], r => {
    const updates = {};
    if (!r.jobs)        updates.jobs        = [];
    if (!r.resumeNames) updates.resumeNames = DEFAULT_RESUMES;
    if (Object.keys(updates).length) chrome.storage.local.set(updates);
  });
});
