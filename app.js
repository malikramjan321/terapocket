const $ = (id) => document.getElementById(id);
const form = $('downloadForm');
const linkInput = $('link');
const statusBox = $('status');
const result = $('result');
const resolveBtn = $('resolveBtn');
const resolveText = $('resolveText');
const spinner = $('spinner');
const filesList = $('filesList');

const allowedHosts = [
  'terabox.com','1024terabox.com','teraboxapp.com','teraboxlink.com',
  '1024tera.com','terabox.app','terabox.fun'
];

function validTeraboxUrl(value){
  try {
    const u = new URL(value.trim());
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && allowedHosts.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

function setLoading(on){
  resolveBtn.disabled = on;
  spinner.classList.toggle('hidden', !on);
  resolveText.textContent = on ? 'Resolving…' : 'Get Download';
}

function showStatus(msg, ok=false){
  statusBox.textContent = msg;
  statusBox.classList.remove('hidden','ok');
  if(ok) statusBox.classList.add('ok');
}

function hideStatus(){ statusBox.classList.add('hidden'); }

function escapeText(value){
  return String(value ?? '');
}

function renderFiles(files){
  filesList.innerHTML = '';
  files.forEach((file, index) => {
    const card = document.createElement('article');
    card.className = 'file-card';

    if (file.thumbnail) {
      const img = document.createElement('img');
      img.className = 'file-thumb';
      img.src = file.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      card.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'file-info';

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = escapeText(file.file_name || `TeraBox file ${index + 1}`);
    info.appendChild(name);

    if (file.file_size) {
      const size = document.createElement('div');
      size.className = 'file-size';
      size.textContent = escapeText(file.file_size);
      info.appendChild(size);
    }

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const download = document.createElement('a');
    download.className = 'primary anchor';
    download.href = file.download_link;
    download.textContent = 'Download File';
    download.rel = 'noopener noreferrer';
    // No target=_blank: a Content-Disposition download stays in the same app instead of opening a TeraBox page.
    actions.appendChild(download);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'secondary';
    copy.textContent = 'Copy Link';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(file.download_link);
        showStatus('Download link copied.', true);
      } catch {
        showStatus('Could not copy automatically.');
      }
    });
    actions.appendChild(copy);

    info.appendChild(actions);
    card.appendChild(info);
    filesList.appendChild(card);
  });
}

$('pasteBtn').addEventListener('click', async () => {
  try {
    linkInput.value = await navigator.clipboard.readText();
    hideStatus();
  } catch {
    showStatus('Clipboard access blocked. Long-press the field and paste manually.');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideStatus();
  result.classList.add('hidden');
  filesList.innerHTML = '';

  const link = linkInput.value.trim();
  if (!validTeraboxUrl(link)) {
    return showStatus('Please paste a valid HTTPS TeraBox share link.');
  }

  setLoading(true);
  try {
    const r = await fetch('/api/download', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({link})
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || 'Could not resolve this link.');

    const files = Array.isArray(data.files) ? data.files : [];
    if (!files.length) throw new Error('Resolver returned no downloadable files.');

    renderFiles(files);
    $('resultTitle').textContent = files.length === 1 ? 'File ready' : `${files.length} files ready`;
    result.classList.remove('hidden');
    showStatus('Download ready.', true);
    result.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (err) {
    showStatus(err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
  }
});

$('themeBtn').addEventListener('click', () => {
  document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
});

if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light');
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
