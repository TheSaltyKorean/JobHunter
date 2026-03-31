// JobHunter — Background Service Worker

// ─── Init ────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get(['jobs', 'profile', 'settings']);

  if (!data.jobs) await chrome.storage.local.set({ jobs: [] });

  if (!data.profile) {
    await chrome.storage.local.set({
      profile: {
        firstName: 'Randy',
        lastName: 'Walker',
        email: 'randy.walker@live.com',
        phone: '',
        address: '',
        city: 'Austin',
        state: 'TX',
        zip: '',
        country: 'United States',
        linkedin: 'https://www.linkedin.com/in/randywalker',
        github: '',
        website: '',
        currentTitle: 'IT Executive',
        yearsExperience: '20',
        salaryMin: '150000',
        salaryExpectation: '180000',
        workAuthorization: 'US Citizen',
        requireSponsorship: 'No',
        gender: '',
        ethnicity: '',
        veteran: 'No',
        disability: 'No',
        coverLetterDefault: ''
      }
    });
  }

  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        autoDetect: true,
        showBadge: true,
        autofillEnabled: true,
        highlightFilled: true
      }
    });
  }

  // Open options on first install
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  }

  updateBadge();
});

// ─── Messaging ───────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_PROFILE': {
      const { profile } = await chrome.storage.local.get('profile');
      return { success: true, data: profile };
    }
    case 'SAVE_PROFILE': {
      await chrome.storage.local.set({ profile: message.profile });
      return { success: true };
    }
    case 'GET_JOBS': {
      const { jobs } = await chrome.storage.local.get('jobs');
      return { success: true, data: jobs || [] };
    }
    case 'SAVE_JOB': {
      const result = await saveJob(message.job);
      await updateBadge();
      return { success: true, data: result };
    }
    case 'UPDATE_JOB': {
      await updateJob(message.id, message.updates);
      await updateBadge();
      return { success: true };
    }
    case 'DELETE_JOB': {
      await deleteJob(message.id);
      await updateBadge();
      return { success: true };
    }
    case 'GET_SETTINGS': {
      const { settings } = await chrome.storage.local.get('settings');
      return { success: true, data: settings };
    }
    case 'SAVE_SETTINGS': {
      await chrome.storage.local.set({ settings: message.settings });
      return { success: true };
    }
    case 'OPEN_DASHBOARD': {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      return { success: true };
    }
    case 'OPEN_OPTIONS': {
      chrome.runtime.openOptionsPage();
      return { success: true };
    }
    case 'GET_STATS': {
      const { jobs: allJobs } = await chrome.storage.local.get('jobs');
      return { success: true, data: computeStats(allJobs || []) };
    }
    default:
      return { success: false, error: 'Unknown message type: ' + message.type };
  }
}

// ─── Job CRUD ─────────────────────────────────────────────────────────────────
async function saveJob(jobData) {
  const { jobs = [] } = await chrome.storage.local.get('jobs');

  // Deduplicate by URL
  const existing = jobs.find(j => j.url && jobData.url && j.url === jobData.url);
  if (existing) return existing;

  const newJob = {
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
    appliedAt: null,
    status: 'saved',
    notes: '',
    salary: '',
    ...jobData
  };

  jobs.unshift(newJob);
  await chrome.storage.local.set({ jobs });
  return newJob;
}

async function updateJob(id, updates) {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const idx = jobs.findIndex(j => j.id === id);
  if (idx !== -1) {
    jobs[idx] = { ...jobs[idx], ...updates, updatedAt: new Date().toISOString() };
    if (updates.status === 'applied' && !jobs[idx].appliedAt) {
      jobs[idx].appliedAt = new Date().toISOString();
    }
    await chrome.storage.local.set({ jobs });
  }
}

async function deleteJob(id) {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  await chrome.storage.local.set({ jobs: jobs.filter(j => j.id !== id) });
}

// ─── Badge ────────────────────────────────────────────────────────────────────
async function updateBadge() {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const interviews = jobs.filter(j => j.status === 'interview').length;
  const offers = jobs.filter(j => j.status === 'offer').length;

  if (offers > 0) {
    chrome.action.setBadgeText({ text: offers.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else if (interviews > 0) {
    chrome.action.setBadgeText({ text: interviews.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function computeStats(jobs) {
  const counts = { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  jobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
  const rate = counts.applied > 0 ? Math.round((counts.interview / counts.applied) * 100) : 0;
  return { ...counts, total: jobs.length, interviewRate: rate };
}
