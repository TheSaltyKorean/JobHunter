// JobHunter Dashboard

let allJobs = [];
let activeFilter = 'all';
let searchQuery = '';
let sortKey = 'savedAt';
let sortDir = 'desc';
let editingJobId = null;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadProfile();
  await loadJobs();
  bindUI();
});

async function loadProfile() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
  if (res?.data) {
    const p = res.data;
    const name = `${p.firstName} ${p.lastName}`.trim() || 'My Profile';
    document.getElementById('profile-name-display').textContent = name;
    const initials = (p.firstName?.[0] || '') + (p.lastName?.[0] || '');
    if (initials) document.getElementById('avatar-initials').textContent = initials.toUpperCase();
  }
}

async function loadJobs() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_JOBS' });
  allJobs = res?.data || [];
  updateStats();
  renderTable();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const counts = { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  allJobs.forEach(j => { if (j.status in counts) counts[j.status]++; });
  const total = allJobs.length;
  const rate = counts.applied > 0 ? Math.round((counts.interview / counts.applied) * 100) : 0;

  document.getElementById('stat-total').textContent     = total;
  document.getElementById('stat-saved').textContent     = counts.saved;
  document.getElementById('stat-applied').textContent   = counts.applied;
  document.getElementById('stat-interview').textContent = counts.interview;
  document.getElementById('stat-offer').textContent     = counts.offer;
  document.getElementById('stat-rate').textContent      = rate + '%';

  // Sidebar badges
  document.getElementById('badge-all').textContent       = total;
  document.getElementById('badge-saved').textContent     = counts.saved;
  document.getElementById('badge-applied').textContent   = counts.applied;
  document.getElementById('badge-interview').textContent = counts.interview;
  document.getElementById('badge-offer').textContent     = counts.offer;
  document.getElementById('badge-rejected').textContent  = counts.rejected;
}

// ── Render Table ──────────────────────────────────────────────────────────────
function renderTable() {
  let jobs = [...allJobs];

  // Filter by status
  if (activeFilter !== 'all') {
    jobs = jobs.filter(j => j.status === activeFilter);
  }

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    jobs = jobs.filter(j =>
      (j.title || '').toLowerCase().includes(q) ||
      (j.company || '').toLowerCase().includes(q) ||
      (j.location || '').toLowerCase().includes(q) ||
      (j.platform || '').toLowerCase().includes(q)
    );
  }

  // Sort
  jobs.sort((a, b) => {
    const av = (a[sortKey] || '').toLowerCase();
    const bv = (b[sortKey] || '').toLowerCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const tbody = document.getElementById('job-tbody');
  const empty = document.getElementById('empty-state');

  if (jobs.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = jobs.map(job => `
    <tr data-id="${esc(job.id)}">
      <td class="td-title"><span title="${esc(job.title)}">${esc(job.title || '—')}</span></td>
      <td class="td-company">${esc(job.company || '—')}</td>
      <td class="td-location">${esc(job.location || '—')}</td>
      <td class="td-platform"><span class="platform-badge">${esc(job.platform || '—')}</span></td>
      <td>
        <span class="status-badge s-${job.status}">
          <span class="status-dot d-${job.status}"></span>
          ${statusLabel(job.status)}
        </span>
      </td>
      <td class="td-date">${fmtDate(job.savedAt)}</td>
      <td class="td-actions">
        <div class="row-actions">
          <button class="row-btn row-btn-status" data-action="edit" data-id="${esc(job.id)}">✏️ Edit</button>
          ${job.url ? `<button class="row-btn row-btn-status" data-action="open" data-url="${esc(job.url)}" title="Open job">↗</button>` : ''}
          <button class="row-btn row-btn-del" data-action="delete" data-id="${esc(job.id)}" title="Delete">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Row click → edit modal
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.dataset.action) return; // handled by button
      const id = row.dataset.id;
      if (id) openModal(id);
    });
  });

  // Button actions
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit')   openModal(id);
      if (action === 'open')   window.open(btn.dataset.url, '_blank');
      if (action === 'delete') confirmDelete(id);
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  editingJobId = id;

  document.getElementById('modal-title').textContent   = job.title   || '—';
  document.getElementById('modal-company').textContent = job.company  || '';
  document.getElementById('modal-status').value        = job.status   || 'saved';
  document.getElementById('modal-salary').value        = job.salary   || '';
  document.getElementById('modal-notes').value         = job.notes    || '';

  const urlEl = document.getElementById('modal-url');
  if (job.url) {
    urlEl.href        = job.url;
    urlEl.textContent = job.url;
    document.getElementById('modal-url-row').style.display = '';
  } else {
    document.getElementById('modal-url-row').style.display = 'none';
  }

  document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  editingJobId = null;
}

async function saveModal() {
  if (!editingJobId) return;
  const updates = {
    status: document.getElementById('modal-status').value,
    salary: document.getElementById('modal-salary').value,
    notes:  document.getElementById('modal-notes').value
  };
  await chrome.runtime.sendMessage({ type: 'UPDATE_JOB', id: editingJobId, updates });
  closeModal();
  await loadJobs();
}

async function confirmDelete(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  if (!confirm(`Delete "${job.title}" at ${job.company}?\nThis cannot be undone.`)) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_JOB', id });
  closeModal();
  await loadJobs();
}

// ── Add Manual Job ────────────────────────────────────────────────────────────
async function addManualJob() {
  const title    = document.getElementById('aj-title').value.trim();
  const company  = document.getElementById('aj-company').value.trim();
  const location = document.getElementById('aj-location').value.trim();
  const platform = document.getElementById('aj-platform').value.trim() || 'Manual';
  const url      = document.getElementById('aj-url').value.trim();
  const status   = document.getElementById('aj-status').value;

  if (!title) { alert('Please enter a job title.'); return; }

  await chrome.runtime.sendMessage({
    type: 'SAVE_JOB',
    job: { title, company, location, platform, url, status }
  });

  // Clear form
  ['aj-title','aj-company','aj-location','aj-platform','aj-url'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-job-form').classList.remove('visible');
  await loadJobs();
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV() {
  const headers = ['Title','Company','Location','Platform','Status','Salary','Date Saved','Date Applied','URL','Notes'];
  const rows = allJobs.map(j => [
    j.title, j.company, j.location, j.platform, j.status,
    j.salary, fmtDate(j.savedAt), fmtDate(j.appliedAt), j.url, j.notes
  ].map(v => `"${(v || '').toString().replace(/"/g,'""')}"`));

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `JobHunter_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Bind UI ───────────────────────────────────────────────────────────────────
function bindUI() {
  // Sidebar nav
  document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      activeFilter = item.dataset.filter;
      document.getElementById('view-title').textContent =
        activeFilter === 'all' ? 'All Jobs' : statusLabel(activeFilter) + ' Jobs';
      renderTable();
    });
  });

  // Stats row click
  document.querySelectorAll('.stat-card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      activeFilter = card.dataset.filter;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelector(`.nav-item[data-filter="${activeFilter}"]`)?.classList.add('active');
      renderTable();
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderTable();
  });

  // Sort select
  document.getElementById('sort-select').addEventListener('change', e => {
    const [key, dir] = e.target.value.split('-');
    sortKey = key;
    sortDir = dir;
    renderTable();
  });

  // Column sort headers
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = 'asc'; }
      renderTable();
    });
  });

  // Add manual
  document.getElementById('btn-add-job').addEventListener('click', () => {
    document.getElementById('add-job-form').classList.toggle('visible');
  });
  document.getElementById('cancel-add').addEventListener('click', () => {
    document.getElementById('add-job-form').classList.remove('visible');
  });
  document.getElementById('confirm-add').addEventListener('click', addManualJob);

  // Export
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('modal-delete').addEventListener('click', () => confirmDelete(editingJobId));
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });

  // Options
  document.getElementById('go-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  saved: 'Saved', applied: 'Applied',
  interview: 'Interview', offer: 'Offer', rejected: 'Rejected'
};
function statusLabel(s) { return STATUS_LABELS[s] || s; }

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
