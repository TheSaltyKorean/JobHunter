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

// ─── Fuzzy Matching — maps question text patterns to answer keys ───────────
const FIELD_RULES = [
  // Name fields
  { patterns: ['first\\s*name', 'given\\s*name', 'nombre'],         key: '_firstName',     type: 'input' },
  { patterns: ['last\\s*name', 'family\\s*name', 'surname'],        key: '_lastName',      type: 'input' },
  { patterns: ['full\\s*name', 'your\\s*name', 'legal\\s*name', 'candidate\\s*name', '^name$', '^name\\b'], key: '_fullName', type: 'input' },

  // Login / Account fields
  { patterns: ['password', 'create.*password', 'new.*password', 'confirm.*password'], key: '_password', type: 'input' },
  { patterns: ['user\\s*name', 'login.*name', 'sign.*in.*name', 'user\\s*id', 'userid'], key: '_username', type: 'input' },

  // Contact
  { patterns: ['e-?mail', 'email\\s*address'],                      key: '_email',         type: 'input' },
  { patterns: ['phone.*number', 'mobile.*number', 'cell.*number', 'telephone.*number', 'contact\\s*number', 'phone\\b', 'mobile\\b', 'cell\\b', 'telephone\\b'], key: '_phone', type: 'input' },
  { patterns: ['phone.*type', 'phone.*device', 'device.*type', 'type.*phone'], key: '_phoneType', type: 'select' },

  // Address fields
  { patterns: ['street.*address', 'address.*line.*1', 'address\\s*1', 'mailing.*address', 'home.*address'], key: '_street', type: 'input' },
  { patterns: ['address.*line.*2', 'address\\s*2', 'apt', 'suite', 'unit'],  key: '_street2',   type: 'input' },
  { patterns: ['^city$', 'city\\b', 'current.*city', 'where.*located'],       key: '_city',      type: 'input' },
  { patterns: ['^state$', 'state\\b', 'province', 'region'],                  key: '_state',     type: 'select' },
  { patterns: ['zip', 'postal.*code', 'post.*code', 'zip.*code'],             key: '_zip',       type: 'input' },
  { patterns: ['country', 'country.*resid', 'country.*citizen'],               key: '_country',   type: 'select' },
  { patterns: ['location', 'current.*location'],                               key: '_location',  type: 'input' },

  // Links
  { patterns: ['linkedin', 'linked\\s*in'],                         key: 'linkedinUrl',    type: 'input' },
  { patterns: ['github'],                                            key: 'githubUrl',      type: 'input' },
  { patterns: ['website', 'portfolio', 'personal.*url', 'blog'],    key: 'websiteUrl',     type: 'input' },

  // Work authorization
  { patterns: ['authorized.*work', 'work.*authoriz', 'eligible.*work', 'legally.*authorized', 'right to work', 'employment.*eligib', 'permission to work'], key: 'workAuthorization', type: 'select' },
  { patterns: ['sponsor', 'visa.*sponsor', 'require.*sponsor', 'need.*sponsor', 'immigration.*sponsor'], key: 'sponsorship', type: 'select' },
  { patterns: ['relocat', 'willing.*relocat', 'open.*relocat'],     key: 'willingToRelocate', type: 'select' },

  // Compensation & availability
  { patterns: ['salary', 'compensation', 'pay.*expect', 'desired.*pay', 'wage', 'expected.*comp', 'annual.*comp'], key: 'desiredSalary', type: 'input' },
  { patterns: ['start.*date', 'earliest.*start', 'when.*start', 'available.*start', 'availability', 'notice.*period'], key: 'startDate', type: 'input' },

  // Experience
  { patterns: ['years.*experience', 'experience.*years', 'how many years', 'total.*experience', 'professional.*experience', 'yrs.*exp'], key: 'yearsExperience', type: 'input' },

  // Education
  { patterns: ['education', 'degree', 'highest.*education', 'education.*level', 'academic'], key: 'educationLevel', type: 'select' },
  { patterns: ['university', 'school', 'college', 'institution', 'alma.*mater'], key: 'university', type: 'input' },
  { patterns: ['graduat.*year', 'year.*graduat', 'class.*of', 'completion.*year'], key: 'graduationYear', type: 'input' },
  { patterns: ['major', 'field.*study', 'concentration', 'discipline'], key: 'major', type: 'input' },
  { patterns: ['gpa', 'grade.*point'],                              key: 'gpa',            type: 'input' },

  // EEO / voluntary self-identification
  { patterns: ['gender', 'sex$', 'sex\\b'],                         key: 'gender',         type: 'select' },
  { patterns: ['veteran', 'military.*service', 'protected.*vet'],   key: 'veteranStatus',  type: 'select' },
  { patterns: ['disabilit', 'handicap'],                             key: 'disabilityStatus', type: 'select' },
  { patterns: ['ethnic', 'race', 'hispanic', 'latino'],             key: 'ethnicity',      type: 'select' },

  // Cover letter / additional
  { patterns: ['cover.*letter', 'letter.*motivation'],               key: 'coverLetter',   type: 'textarea' },
  { patterns: ['additional.*info', 'anything.*else', 'comments', 'notes.*recruiter'], key: 'additionalInfo', type: 'textarea' },
  { patterns: ['how.*hear', 'where.*hear', 'how.*find', 'referral.*source', 'source'], key: 'howDidYouHear', type: 'input' },
  { patterns: ['referred.*by', 'referr'],                           key: 'referredBy',     type: 'input' },

  // Common yes/no questions
  { patterns: ['previously.*worked', 'previously.*employed', 'former.*employee', 'ever.*worked.*for', 'have you.*worked'], key: '_previouslyWorked', type: 'select' },
  { patterns: ['non.*compete', 'non-compete', 'restrictive.*covenant', 'non.*disclosure'], key: '_nonCompete', type: 'select' },
  { patterns: ['background.*check', 'consent.*background', 'authorize.*background'], key: '_backgroundCheck', type: 'select' },
  { patterns: ['drug.*test', 'drug.*screen', 'substance.*test'],    key: '_drugTest',      type: 'select' },
  { patterns: ['felony', 'convicted', 'criminal.*record', 'criminal.*history', 'been convicted'], key: '_criminalHistory', type: 'select' },
  { patterns: ['18.*years', 'over.*18', 'age.*18', 'at.*least.*18', 'legally.*age'], key: '_over18', type: 'select' },
];

// Compile regex once at startup
const COMPILED_RULES = FIELD_RULES.map(rule => ({
  ...rule,
  regexes: rule.patterns.map(p => new RegExp(p, 'i')),
}));

function matchQuestionToKey(questionText) {
  const text = (questionText || '').toLowerCase().trim();
  if (!text) return null;
  let bestMatch = null;
  let bestScore = 0;
  for (const rule of COMPILED_RULES) {
    for (const rx of rule.regexes) {
      if (rx.test(text)) {
        const score = rx.source.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { key: rule.key, type: rule.type };
        }
      }
    }
  }
  return bestMatch;
}

// ─── Claude CLI companion server (runs on localhost:3847) ──────────────────
async function getClaudeServerPort() {
  return new Promise(resolve => {
    chrome.storage.local.get(['claudeServerPort'], r => resolve(r.claudeServerPort || 3847));
  });
}

async function getCustomQA() {
  return new Promise(resolve => {
    chrome.storage.local.get(['customQA'], r => resolve(r.customQA || []));
  });
}

async function askClaude(question, profile, qa) {
  const port = await getClaudeServerPort();

  const profileSummary = Object.entries(profile)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const qaSummary = Object.entries(qa)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  try {
    const resp = await fetch(`http://localhost:${port}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        profile: profileSummary,
        qa: qaSummary,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const answer = data?.answer?.trim();
    if (!answer || answer === 'SKIP') return null;
    return answer;
  } catch (e) {
    // Server not running — that's fine, just skip
    console.log('JobHunter: Claude CLI server not reachable at localhost:' + port);
    return null;
  }
}

async function isClaudeServerRunning() {
  const port = await getClaudeServerPort();
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ─── Job Context Tracking (persists across tab navigations) ─────────────────
// When you find a job on LinkedIn and click Apply, the tab navigates to an ATS.
// We store the job context per tab so the sidebar on the ATS page knows what job
// you're applying to.

const tabJobContext = new Map(); // tabId → { title, company, location, platform, url, originUrl, jobType }

// Known job board hostnames (where jobs are FOUND)
const JOB_BOARD_HOSTS = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'dice.com', 'monster.com'];

// URL patterns that indicate an application/ATS site
const ATS_PATTERNS = [
  /myworkdayjobs\.com/i, /greenhouse\.io/i, /lever\.co/i, /icims\.com/i,
  /taleo\.net/i, /brassring\.com/i, /smartrecruiters\.com/i, /jobvite\.com/i,
  /ashbyhq\.com/i, /bamboohr\.com/i, /recruitee\.com/i, /workable\.com/i,
  /applicantpro\.com/i, /paylocity\.com/i, /ultipro\.com/i, /adp\.com/i,
  /successfactors\.com/i, /cornerstoneondemand\.com/i, /avature\.net/i,
  /phenom\.com/i, /eightfold\.ai/i, /apply/i, /careers?\./i, /jobs?\./i,
];

function isJobBoard(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return JOB_BOARD_HOSTS.some(h => host.includes(h));
  } catch { return false; }
}

function isATSSite(url) {
  return ATS_PATTERNS.some(rx => rx.test(url));
}

function isJobRelatedSite(url) {
  return isJobBoard(url) || isATSSite(url);
}

// Clean up when tabs close
chrome.tabs.onRemoved.addListener(tabId => {
  tabJobContext.delete(tabId);
});

// Detect navigation: if tab goes from job board → ATS, carry the context
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  // If this tab has stored context and the new URL is an ATS site,
  // the content script will pick it up via GET_JOB_CONTEXT
  const ctx = tabJobContext.get(tabId);
  if (ctx) {
    console.log(`JobHunter: Tab ${tabId} navigated to ${tab.url}, job context available: ${ctx.title}`);
  }
});

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

// ─── Resume file access ──────────────────────────────────────────────────
// Resume PDFs live in resumes/ folder inside the extension directory.
// Filenames: cloud.pdf, it-mgmt.pdf, executive.pdf, staffing.pdf

async function getResumeFileInfo(type) {
  const url = chrome.runtime.getURL(`resumes/${type}.pdf`);
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      console.warn(`JobHunter: resumes/${type}.pdf fetch returned ${resp.status}`);
      return null;
    }
    const blob = await resp.blob();
    // Check it's actually a PDF and not an error page
    if (blob.size < 100 || blob.type === 'text/html') {
      console.warn(`JobHunter: resumes/${type}.pdf seems invalid (size=${blob.size}, type=${blob.type})`);
      return null;
    }
    return { name: `${type}.pdf`, size: blob.size, url };
  } catch (e) {
    console.warn(`JobHunter: resumes/${type}.pdf fetch error:`, e.message);
    return null;
  }
}

async function getResumeBase64(type) {
  const url = chrome.runtime.getURL(`resumes/${type}.pdf`);
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (blob.size < 100 || blob.type === 'text/html') return null;
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        data: reader.result.split(',')[1],
        name: `${type}.pdf`,
        size: blob.size,
      });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
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

  // ── Get resume file info ──────────────────────────────────────────────────
  if (msg.type === 'GET_RESUME_FILE') {
    (async () => {
      const file = await getResumeFileInfo(msg.resumeType);
      sendResponse(file);
    })();
    return true;
  }

  // ── Get all resume file info (checks which PDFs exist in resumes/) ────────
  if (msg.type === 'GET_RESUME_FILES_INFO') {
    (async () => {
      const info = {};
      for (const type of ['cloud', 'it-mgmt', 'executive', 'staffing']) {
        const file = await getResumeFileInfo(type);
        if (file) {
          info[type] = { name: file.name, size: file.size };
        }
      }
      console.log('JobHunter: Resume files info:', JSON.stringify(info));
      sendResponse(info);
    })();
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
      if (chrome.runtime.lastError) {
        console.error('JobHunter: QA save error:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('JobHunter: QA saved successfully', msg.answers);
        sendResponse({ ok: true });
      }
    });
    return true;
  }

  // ── Get auto-fill data bundle (profile + Q&A + resume) ───────────────────
  if (msg.type === 'GET_AUTOFILL_DATA') {
    (async () => {
      const profile      = await getProfile();
      const qa           = await getQAAnswers();
      const resumeNames  = await getResumeNames();
      const customQA     = await getCustomQA();
      const claudeReady  = await isClaudeServerRunning();
      const credentials  = await new Promise(resolve => {
        chrome.storage.local.get(['atsCredentials'], r => resolve(r.atsCredentials || {}));
      });

      // Get resume as base64 for the content script
      const resumeFile = await getResumeBase64(msg.resumeType || 'it-mgmt');

      sendResponse({ profile, qa, resumeNames, resumeFile, customQA, credentials, hasClaudeKey: claudeReady });
    })();
    return true;
  }

  // ── Fuzzy match a question label to a known answer key ───────────────────
  if (msg.type === 'MATCH_QUESTION') {
    const match = matchQuestionToKey(msg.question);
    sendResponse(match);
    return true; // changed to true for consistency
  }

  // ── Ask Claude CLI for an answer to an unknown question ──────────────────
  if (msg.type === 'ASK_CLAUDE') {
    (async () => {
      const profile = await getProfile();
      const qa      = await getQAAnswers();
      const answer  = await askClaude(msg.question, profile, qa);
      sendResponse({ answer });
    })();
    return true;
  }

  // ── Save custom Q&A pairs ────────────────────────────────────────────────
  if (msg.type === 'SAVE_CUSTOM_QA') {
    chrome.storage.local.set({ customQA: msg.pairs }, () => {
      if (chrome.runtime.lastError) {
        console.error('JobHunter: Custom QA save error:', chrome.runtime.lastError.message);
        sendResponse({ ok: false });
      } else {
        console.log('JobHunter: Custom QA saved', msg.pairs);
        sendResponse({ ok: true });
      }
    });
    return true;
  }

  // ── Get custom Q&A pairs ─────────────────────────────────────────────────
  if (msg.type === 'GET_CUSTOM_QA') {
    (async () => { sendResponse(await getCustomQA()); })();
    return true;
  }

  // ── Save Claude server port ──────────────────────────────────────────────
  if (msg.type === 'SAVE_CLAUDE_PORT') {
    chrome.storage.local.set({ claudeServerPort: msg.port }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Check Claude server status ───────────────────────────────────────────
  if (msg.type === 'CHECK_CLAUDE_SERVER') {
    (async () => {
      const running = await isClaudeServerRunning();
      sendResponse({ running });
    })();
    return true;
  }

  // ── Store job context for a tab (from content script on LinkedIn/Indeed) ──
  if (msg.type === 'SET_JOB_CONTEXT') {
    const tabId = _sender.tab?.id;
    if (tabId && msg.job) {
      tabJobContext.set(tabId, {
        ...msg.job,
        originUrl: _sender.tab.url,
        storedAt: Date.now(),
      });
      console.log(`JobHunter: Stored job context for tab ${tabId}: ${msg.job.title}`);
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── Get job context for current tab ──────────────────────────────────────
  if (msg.type === 'GET_JOB_CONTEXT') {
    const tabId = _sender.tab?.id;
    const ctx = tabId ? tabJobContext.get(tabId) : null;
    sendResponse(ctx || null);
    return true;
  }

  // ── Check if current URL is a known job-related site ─────────────────────
  if (msg.type === 'IS_JOB_SITE') {
    const url = msg.url || '';
    sendResponse({
      isJobBoard: isJobBoard(url),
      isATS: isATSSite(url),
      isJobRelated: isJobRelatedSite(url),
    });
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
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      try {
        // Try sending message to content script first
        await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SIDEBAR' });
      } catch (e) {
        // Content script not loaded — inject it programmatically
        console.log('JobHunter: Content script not found, injecting programmatically...');
        try {
          await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          console.log('JobHunter: Content script injected successfully');
        } catch (injectErr) {
          console.error('JobHunter: Failed to inject content script:', injectErr.message);
        }
      }
    });
    return false;
  }

  // If we don't recognize the message, return true to prevent port closure issues
  return true;
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
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SIDEBAR' });
      } catch (e) {
        // Content script not loaded — inject programmatically
        try {
          await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        } catch (injectErr) {
          console.error('JobHunter: Failed to inject:', injectErr.message);
        }
      }
    });
  }
});
