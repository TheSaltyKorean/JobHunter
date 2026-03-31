// JobHunter Popup

document.addEventListener('DOMContentLoaded', async () => {
  const { data: jobs = [] } = await chrome.runtime.sendMessage({ type: 'GET_JOBS' });

  // Stats
  const counts = { saved: 0, applied: 0, interview: 0, offer: 0 };
  jobs.forEach(j => { if (j.status in counts) counts[j.status]++; });

  document.getElementById('n-saved').textContent     = counts.saved;
  document.getElementById('n-applied').textContent   = counts.applied;
  document.getElementById('n-interview').textContent = counts.interview;
  document.getElementById('n-offer').textContent     = counts.offer;

  // Recent jobs list
  const list = document.getElementById('job-list');
  if (jobs.length > 0) {
    list.innerHTML = '';
    jobs.slice(0, 10).forEach(job => {
      const item = document.createElement('div');
      item.className = 'job-item';
      item.innerHTML = `
        <div class="status-pip pip-${job.status}"></div>
        <div class="job-text">
          <div class="job-name">${esc(job.title || 'Unknown Position')}</div>
          <div class="job-co">${esc(job.company || '')}${job.company && job.platform ? ' · ' : ''}${esc(job.platform || '')}</div>
        </div>
        <div class="job-arrow">›</div>
      `;
      item.addEventListener('click', () => {
        if (job.url) chrome.tabs.create({ url: job.url });
        window.close();
      });
      list.appendChild(item);
    });
  }

  // Buttons
  document.getElementById('btn-dashboard').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  });

  document.getElementById('btn-profile').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
});

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
