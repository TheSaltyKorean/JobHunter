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
// Each rule: { patterns: [regex strings], key: qaKey, type: 'input'|'select'|'radio'|'textarea' }
const FIELD_RULES = [
  // Name fields
  { patterns: ['first\\s*name', 'given\\s*name', 'nombre'],         key: '_firstName',     type: 'input' },
  { patterns: ['last\\s*name', 'family\\s*name', 'surname'],        key: '_lastName',      type: 'input' },
  { patterns: ['full\\s*name', 'your\\s*name', 'legal\\s*name', 'candidate\\s*name', '^name$', '^name\\b'], key: '_fullName', type: 'input' },

  // Contact
  { patterns: ['e-?mail', 'email\\s*address'],                      key: '_email',         type: 'input' },
  { patterns: ['phone', 'mobile', 'cell', 'telephone', 'contact\\s*number'], key: '_phone', type: 'input' },
  { patterns: ['city', 'location', 'address', 'where.*located', 'current.*city'], key: '_location', type: 'input' },

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
  { patterns: ['country', 'country.*resid', 'country.*citizen'],    key: 'country',        type: 'select' },
  { patterns: ['state', 'province'],                                 key: 'state',          type: 'select' },
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
        // Prefer more specific (longer) pattern matches
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

// ─── Claude API for unknown questions ──────────────────────────────────────
async function getClaudeApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['claudeApiKey'], r => resolve(r.claudeApiKey || ''));
  });
}

async function getCustomQA() {
  return new Promise(resolve => {
    chrome.storage.local.get(['customQA'], r => resolve(r.customQA || []));
  });
}

async function askClaude(question, profile, qa) {
  const apiKey = await getClaudeApiKey();
  if (!apiKey) return null;

  const profileSummary = Object.entries(profile)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const qaSummary = Object.entries(qa)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 300,
        system: `You are helping fill out a job application. Given the applicant's profile and a question from the application form, provide ONLY the answer text — no explanation, no quotes, no extra formatting. If it's a yes/no or multiple choice question, respond with just the matching option. If you truly cannot determine an answer, respond with exactly: SKIP`,
        messages: [{
          role: 'user',
          content: `Applicant profile:\n${profileSummary}\n\nKnown Q&A:\n${qaSummary}\n\nApplication question: "${question}"\n\nProvide the best answer:`,
        }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const answer = data?.content?.[0]?.text?.trim();
    if (!answer || answer === 'SKIP') return null;
    return answer;
  } catch (e) {
    console.error('JobHunter Claude API error:', e);
    return null;
  }
}

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
      if (chrome.runtime.lastError) {
        console.error('Resume save error:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true });
      }
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
      const customQA    = await getCustomQA();
      const claudeApiKey = await getClaudeApiKey();
      sendResponse({ profile, qa, resumeNames, resumeFile, customQA, hasClaudeKey: !!claudeApiKey });
    })();
    return true;
  }

  // ── Fuzzy match a question label to a known answer key ───────────────────
  if (msg.type === 'MATCH_QUESTION') {
    const match = matchQuestionToKey(msg.question);
    sendResponse(match);
    return false;
  }

  // ── Ask Claude API for an answer to an unknown question ──────────────────
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
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Get custom Q&A pairs ─────────────────────────────────────────────────
  if (msg.type === 'GET_CUSTOM_QA') {
    (async () => { sendResponse(await getCustomQA()); })();
    return true;
  }

  // ── Save Claude API key ──────────────────────────────────────────────────
  if (msg.type === 'SAVE_CLAUDE_API_KEY') {
    chrome.storage.local.set({ claudeApiKey: msg.key }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Get Claude API key ───────────────────────────────────────────────────
  if (msg.type === 'GET_CLAUDE_API_KEY') {
    (async () => { sendResponse({ key: await getClaudeApiKey() }); })();
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
