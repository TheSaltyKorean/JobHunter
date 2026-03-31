// JobHunter — Dashboard
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META = {
  saved:     { label: 'Saved',     color: '#94a3b8', icon: '📌' },
  applied:   { label: 'Applied',   color: '#6366f1', icon: '📤' },
  interview: { label: 'Interview', color: '#f59e0b', icon: '🗣️' },
  offer:     { label: 'Offer',     color: '#10b981', icon: '🎉' },
  rejected:  { label: 'Rejected',  color: '#ef4444', icon: '✖' },
};

// Dynamic — loaded from storage, with hardcoded fallback
let TYPE_META = {
  cloud:     { label: 'Cloud / Infra', icon: '☁️',  color: '#0ea5e9' },
  'it-mgmt': { label: 'IT Mgmt',       icon: '💼',  color: '#6366f1' },
  executive: { label: 'Executive',     icon: '🏆',  color: '#f59e0b' },
  staffing:  { label: 'Staffing',      icon: '🏢',  color: '#94a3b8' },
};

const TYPE_COLORS = ['#0ea5e9', '#6366f1', '#f59e0b', '#94a3b8', '#10b981', '#ef4444'];

const DEFAULT_RESUMES = {
  cloud:     'Cloud & Infrastructure Resume',
  'it-mgmt': 'IT Management Resume',
  executive: 'Executive Resume',
  staffing:  'Staffing Agency Resume',
};

// Load dynamic job types into TYPE_META
function loadDynamicTypes() {
  chrome.storage.local.get(['jobTypes'], r => {
    if (r.jobTypes && r.jobTypes.length) {
      TYPE_META = {};
      r.jobTypes.forEach((jt, i) => {
        TYPE_META[jt.key] = { label: jt.label, icon: jt.emoji, color: TYPE_COLORS[i % TYPE_COLORS.length] };
      });
    }
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let allJobs      = [];
let resumeNames  = { ...DEFAULT_RESUMES };
let filterStatus = 'all';
let filterType   = 'all';
let sortKey      = 'savedAt-desc';
let searchQuery  = '';
let selectedJob  = null;

// ── Load ──────────────────────────────────────────────────────────────────────
function loadAll() {
  chrome.storage.local.get(['jobs', 'profile', 'resumeNames'], r => {
    allJobs     = r.jobs        || [];
    resumeNames = { ...DEFAULT_RESUMES, ...(r.resumeNames || {}) };
    const p     = r.profile     || {};

    // Profile display
    const name = p.name || 'Randy Walker';
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const el = document.getElementById('avatar-initials');
    if (el) el.textContent = initials;
    const nm = document.getElementById('profile-name-display');
    if (nm) nm.textContent = name;

    render();
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  updateBadges();
  updateStats();
  renderTable();
}

function filteredJobs() {
  let jobs = [...allJobs];

  if (filterStatus !== 'all') jobs = jobs.filter(j => j.status === filterStatus);
  if (filterType   !== 'all') jobs = jobs.filter(j => (j.jobType || 'it-mgmt') === filterType);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    jobs = jobs.filter(j =>
      (j.title   || '').toLowerCase().includes(q) ||
      (j.company || '').toLowerCase().includes(q) ||
      (j.location|| '').toLowerCase().includes(q) ||
      (j.resumeUsed||'').toLowerCase().includes(q)
    );
  }

  const [key, dir] = sortKey.split('-');
  jobs.sort((a, b) => {
    const av = (a[key] || '').toString().toLowerCase();
    const bv = (b[key] || '').toString().toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 :  1;
    if (av > bv) return dir === 'asc' ?  1 : -1;
    return 0;
  });

  return jobs;
}

function updateBadges() {
  const counts = { all: allJobs.length };
  Object.keys(STATUS_META).forEach(s => { counts[s] = 0; });
  allJobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });

  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById(`badge-${k}`);
    if (el) el.textContent = v;
  });

  // Type badges
  const typeCounts = {};
  allJobs.forEach(j => {
    const t = j.jobType || 'it-mgmt';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  Object.entries(typeCounts).forEach(([k, v]) => {
    const el = document.getElementById(`badge-type-${k}`);
    if (el) el.textContent = v;
  });
}

function updateStats() {
  const jobs       = allJobs;
  const total      = jobs.length;
  const applied    = jobs.filter(j => j.status === 'applied').length;
  const interviews = jobs.filter(j => j.status === 'interview').length;
  const offers     = jobs.filter(j => j.status === 'offer').length;
  const saved      = jobs.filter(j => j.status === 'saved').length;
  const rate       = applied > 0 ? Math.round((interviews / applied) * 100) : 0;

  setText('stat-total',     total);
  setText('stat-saved',     saved);
  setText('stat-applied',   applied);
  setText('stat-interview', interviews);
  setText('stat-offer',     offers);
  setText('stat-rate',      rate + '%');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function renderTable() {
  const tbody  = document.getElementById('job-tbody');
  const empty  = document.getElementById('empty-state');
  const jobs   = filteredJobs();

  if (!tbody) return;
  tbody.innerHTML = '';

  if (jobs.length === 0) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  jobs.forEach(job => {
    const sm   = STATUS_META[job.status]  || STATUS_META.saved;
    const tm   = TYPE_META[job.jobType]   || TYPE_META['it-mgmt'];
    const date = new Date(job.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="job-title-cell">
          ${job.url ? `<a href="${escHtml(job.url)}" target="_blank" class="job-title-link">${escHtml(job.title)}</a>`
                    : `<span>${escHtml(job.title)}</span>`}
        </div>
      </td>
      <td>${escHtml(job.company)}</td>
      <td>${escHtml(job.location)}</td>
      <td>${escHtml(job.platform)}</td>
      <td>
        <span class="type-badge" style="color:${tm.color};background:${tm.color}22">
          ${tm.icon} ${tm.label}
        </span>
      </td>
      <td>
        <span class="status-badge" style="color:${sm.color};background:${sm.color}22">
          ${sm.icon} ${sm.label}
        </span>
      </td>
      <td class="resume-cell" title="${escHtml(job.resumeUsed || '')}">
        ${escHtml(shortResumeName(job.resumeUsed || ''))}
      </td>
      <td>${date}</td>
      <td>
        <button class="btn btn-ghost btn-sm edit-btn" data-id="${job.id}">Edit</button>
      </td>
    `;
    tr.addEventListener('click', e => {
      if (!e.target.classList.contains('edit-btn') && !e.target.closest('a')) openModal(job);
    });
    tr.querySelector('.edit-btn').addEventListener('click', e => {
      e.stopPropagation();
      openModal(job);
    });
    tbody.appendChild(tr);
  });
}

function shortResumeName(name) {
  // Strip file extension and truncate
  return name.replace(/\.(pdf|docx?|txt)$/i, '').slice(0, 28) + (name.length > 28 ? '…' : '');
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(job) {
  selectedJob = job;
  const sm = STATUS_META[job.status] || STATUS_META.saved;

  document.getElementById('modal-title').textContent   = job.title   || '—';
  document.getElementById('modal-company').textContent = job.company || '—';
  document.getElementById('modal-status').value        = job.status  || 'saved';
  document.getElementById('modal-notes').value         = job.notes   || '';
  document.getElementById('modal-salary').value        = job.salary  || '';

  // Job type
  const jtEl = document.getElementById('modal-jobtype');
  if (jtEl) jtEl.value = job.jobType || 'it-mgmt';

  // Resume dropdown — populate with current resume names
  const resEl = document.getElementById('modal-resume');
  if (resEl) {
    resEl.innerHTML = '';
    Object.entries(resumeNames).forEach(([type, name]) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === job.resumeUsed) opt.selected = true;
      resEl.appendChild(opt);
    });
    // If the stored resumeUsed doesn't match any current name, add it
    if (job.resumeUsed && ![...resEl.options].some(o => o.value === job.resumeUsed)) {
      const opt = document.createElement('option');
      opt.value = job.resumeUsed;
      opt.textContent = job.resumeUsed;
      opt.selected = true;
      resEl.insertBefore(opt, resEl.firstChild);
    }
  }

  const urlRow = document.getElementById('modal-url-row');
  const urlEl  = document.getElementById('modal-url');
  if (job.url) {
    if (urlRow) urlRow.style.display = '';
    if (urlEl)  { urlEl.href = job.url; urlEl.textContent = job.url; }
  } else {
    if (urlRow) urlRow.style.display = 'none';
  }

  document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  selectedJob = null;
}

// ── Event wiring ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDynamicTypes();
  loadAll();

  // Search
  document.getElementById('search-input')?.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    render();
  });

  // Sort
  document.getElementById('sort-select')?.addEventListener('change', e => {
    sortKey = e.target.value;
    render();
  });

  // Status filter (sidebar)
  document.querySelectorAll('.nav-item[data-filter]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-filter]').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      filterStatus = el.dataset.filter;
      document.getElementById('view-title').textContent =
        filterStatus === 'all' ? 'All Jobs' : (STATUS_META[filterStatus]?.label || 'Jobs');
      render();
    });
  });

  // Type filter (sidebar)
  document.querySelectorAll('.nav-item[data-type-filter]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-type-filter]').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      // Also reset status filter
      document.querySelectorAll('.nav-item[data-filter]').forEach(x => x.classList.remove('active'));
      filterType   = el.dataset.typeFilter;
      filterStatus = 'all';
      document.getElementById('view-title').textContent =
        filterType === 'all' ? 'All Jobs' : (TYPE_META[filterType]?.label || 'Jobs');
      render();
    });
  });

  // Column sort
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const [k, d] = sortKey.split('-');
      sortKey = k === th.dataset.sort && d === 'asc' ? `${th.dataset.sort}-desc` : `${th.dataset.sort}-asc`;
      render();
    });
  });

  // Modal close
  document.getElementById('modal-close')?.addEventListener('click',  closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });

  // Modal save
  document.getElementById('modal-save')?.addEventListener('click', () => {
    if (!selectedJob) return;
    const jobType   = document.getElementById('modal-jobtype')?.value || selectedJob.jobType;
    const resumeUsed = document.getElementById('modal-resume')?.value  || selectedJob.resumeUsed;
    const updated = {
      ...selectedJob,
      status:    document.getElementById('modal-status').value,
      notes:     document.getElementById('modal-notes').value,
      salary:    document.getElementById('modal-salary').value,
      jobType,
      resumeUsed,
    };
    chrome.storage.local.get(['jobs'], r => {
      const jobs = (r.jobs || []).map(j => j.id === updated.id ? updated : j);
      chrome.storage.local.set({ jobs }, () => {
        allJobs = jobs;
        closeModal();
        render();
      });
    });
  });

  // Modal delete
  document.getElementById('modal-delete')?.addEventListener('click', () => {
    if (!selectedJob || !confirm(`Delete "${selectedJob.title}" at ${selectedJob.company}?`)) return;
    chrome.storage.local.get(['jobs'], r => {
      const jobs = (r.jobs || []).filter(j => j.id !== selectedJob.id);
      chrome.storage.local.set({ jobs }, () => {
        allJobs = jobs;
        closeModal();
        render();
      });
    });
  });

  // Add job manually
  document.getElementById('btn-add-job')?.addEventListener('click', () => {
    document.getElementById('add-job-form')?.classList.toggle('visible');
  });
  document.getElementById('cancel-add')?.addEventListener('click', () => {
    document.getElementById('add-job-form')?.classList.remove('visible');
  });
  document.getElementById('confirm-add')?.addEventListener('click', () => {
    const title   = document.getElementById('aj-title')?.value.trim();
    const company = document.getElementById('aj-company')?.value.trim();
    if (!title || !company) { alert('Title and Company are required.'); return; }

    const jobType   = document.getElementById('aj-jobtype')?.value    || 'it-mgmt';
    const resumeUsed = resumeNames[jobType] || resumeNames['it-mgmt'];

    const job = {
      id:        crypto.randomUUID(),
      title,
      company,
      location:  document.getElementById('aj-location')?.value.trim() || '',
      platform:  document.getElementById('aj-platform')?.value.trim() || '',
      url:       document.getElementById('aj-url')?.value.trim()      || '',
      status:    document.getElementById('aj-status')?.value          || 'saved',
      jobType,
      resumeUsed,
      notes:     '',
      salary:    '',
      savedAt:   Date.now(),
    };
    chrome.storage.local.get(['jobs'], r => {
      const jobs = [...(r.jobs || []), job];
      chrome.storage.local.set({ jobs }, () => {
        allJobs = jobs;
        document.getElementById('add-job-form')?.classList.remove('visible');
        ['aj-title','aj-company','aj-location','aj-platform','aj-url'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
        render();
      });
    });
  });

  // Export CSV
  document.getElementById('btn-export')?.addEventListener('click', exportCSV);

  // Go to options
  document.getElementById('go-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportCSV() {
  const headers = ['Title','Company','Location','Platform','Job Type','Status','Resume Used','Salary','Notes','URL','Saved At'];
  const rows    = filteredJobs().map(j => [
    j.title, j.company, j.location, j.platform,
    TYPE_META[j.jobType]?.label || j.jobType || '',
    STATUS_META[j.status]?.label || j.status || '',
    j.resumeUsed || '',
    j.salary || '', j.notes || '', j.url || '',
    new Date(j.savedAt).toLocaleDateString(),
  ].map(v => `"${String(v).replace(/"/g,'""')}"`));

  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `jobhunter-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
