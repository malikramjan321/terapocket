const ALLOWED_HOSTS = [
  'terabox.app','teraboxshare.com','terabox.com','1024terabox.com','teraboxlink.com',
  'terasharefile.com','terafileshare.com','terasharelink.com','1024tera.com',
  'freeterabox.com','teraboxurl.com','teraboxapp.com','terabox.fun'
];

const DEFAULT_GATEWAY = 'https://tera-core.vercel.app/api';
const DEFAULT_WORKER = 'https://tbx-proxy.shakir-ansarii075.workers.dev';

function isAllowedTeraBoxUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

function extractSurl(value) {
  const u = new URL(value);
  let surl = u.searchParams.get('surl') || '';
  if (!surl && u.pathname.includes('/s/')) surl = u.pathname.split('/s/')[1]?.split('/')[0] || '';
  surl = decodeURIComponent(surl).trim();
  return surl;
}

function rawSurl(value) {
  const s = extractSurl(value);
  return s.startsWith('1') && s.length > 1 ? s.slice(1) : s;
}

function canonicalShareUrl(value) {
  const s = extractSurl(value);
  const withPrefix = s.startsWith('1') ? s : `1${s}`;
  return `https://1024terabox.com/s/${withPrefix}`;
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '';
  const units = ['B','KB','MB','GB','TB'];
  let size = n, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
  return `${size >= 10 || i === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[i]}`;
}

function pickThumb(file = {}) {
  const t = file.thumbnails || file.thumbs || file.thumbnail || file.thumb || {};
  if (typeof t === 'string') return t;
  return t.original || t.url3 || t.url2 || t.url1 || t.icon || '';
}

function normalizeFile(file = {}, fallback = {}) {
  const sizeBytes = Number(file.size_bytes ?? file.size ?? file.file_size ?? fallback.size ?? 0);
  const dlink = file.direct_link || file.download_link || file.dlink || file.download_url || file.link || fallback.dlink || '';
  return {
    file_name: file.server_filename || file.filename || file.file_name || file.name || fallback.name || 'TeraBox file',
    file_size: typeof file.size === 'string' && /[A-Za-z]/.test(file.size) ? file.size : (file.size_text || formatBytes(sizeBytes)),
    size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
    thumbnail: pickThumb(file) || pickThumb(fallback),
    download_link: typeof dlink === 'string' ? dlink : '',
    fs_id: String(file.fs_id || file.fid || fallback.fid || '')
  };
}

function filesFromPayload(payload = {}) {
  const roots = [payload, payload?.data, payload?.upstream].filter(Boolean);
  const found = [];
  for (const root of roots) {
    if (Array.isArray(root)) found.push(...root);
    if (Array.isArray(root?.files)) found.push(...root.files);
    if (Array.isArray(root?.list)) found.push(...root.list);
    if (!Array.isArray(root) && root && typeof root === 'object') {
      if (root.dlink || root.direct_link || root.download_link || root.server_filename || root.filename) found.push(root);
    }
  }
  const seen = new Set();
  return found.map((f) => normalizeFile(f, payload)).filter((f) => {
    const key = `${f.fs_id}|${f.file_name}|${f.download_link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorFrom(data, fallback) {
  if (!data) return fallback;
  return data.error || data.message || data.errmsg || data?.details?.errmsg || fallback;
}

async function fetchJson(url, ndus, signal) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Cookie: `ndus=${ndus}`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1 TeraPocket/4.0'
    },
    signal,
    redirect: 'follow'
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { response, data, text };
}

async function tryHostedGateway(base, shareUrl, ndus, signal, fullyResolve = false) {
  const u = new URL(base);
  u.searchParams.set('url', shareUrl);
  if (fullyResolve) u.searchParams.set('resolve', 'true');
  const out = await fetchJson(u, ndus, signal);
  if (!out.response.ok) return { ok:false, error:errorFrom(out.data, `Gateway HTTP ${out.response.status}`) };
  if (!out.data) return { ok:false, error:'Gateway returned a non-JSON response.' };
  if (out.data.error || out.data.status === 'error') return { ok:false, error:errorFrom(out.data, 'Gateway error') };
  const files = filesFromPayload(out.data).filter(f => /^https:\/\//i.test(f.download_link));
  return files.length ? { ok:true, files, source: fullyResolve ? 'hosted-gateway-resolved' : 'hosted-gateway-fast' } : { ok:false, error:'Gateway returned no download link.' };
}

async function tryWorker(base, surl, ndus, signal) {
  const u = new URL(base.replace(/\/$/, '') + '/');
  u.searchParams.set('mode', 'resolve');
  u.searchParams.set('surl', surl);
  u.searchParams.set('raw', '1');
  u.searchParams.set('refresh', '1');
  const out = await fetchJson(u, ndus, signal);
  if (!out.response.ok) return { ok:false, error:errorFrom(out.data, `Worker HTTP ${out.response.status}`) };
  if (!out.data) return { ok:false, error:'Worker returned a non-JSON response.' };
  if (out.data.error) return { ok:false, error:errorFrom(out.data, 'Worker error') };
  const files = filesFromPayload(out.data).filter(f => /^https:\/\//i.test(f.download_link));
  return files.length ? { ok:true, files, source:'worker' } : { ok:false, error:'Worker returned no direct download link.' };
}

export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error:'Method not allowed' }, { status:405 });

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error:'Invalid JSON' }, { status:400 }); }

  const link = String(body?.link || '').trim();
  if (!isAllowedTeraBoxUrl(link)) return Response.json({ error:'Please use a supported HTTPS TeraBox share link.' }, { status:400 });

  const surl = rawSurl(link);
  if (!surl) return Response.json({ error:'Could not read the TeraBox share ID from this link.' }, { status:400 });

  const ndus = (Netlify.env.get('TERABOX_NDUS') || '').trim();
  if (!ndus) {
    return Response.json({
      error:'TeraPocket v5 needs TERABOX_NDUS in Netlify Environment variables. Add your own TeraBox ndus session value, then redeploy.',
      needs_ndus:true
    }, { status:503 });
  }

  const gateway = (Netlify.env.get('TERABOX_GATEWAY_BASE') || DEFAULT_GATEWAY).trim();
  const worker = (Netlify.env.get('TERABOX_WORKER_BASE') || DEFAULT_WORKER).trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 26000);
  const attempts = [];

  try {
    // 1) Fast gateway mode first. The upstream docs recommend the default
    //    short redirect links because it avoids slow PCS redirect resolution.
    try {
      const r = await tryHostedGateway(gateway, link, ndus, controller.signal, false);
      if (r.ok) return Response.json({ success:true, files:r.files, file_count:r.files.length, source:r.source, authenticated:true }, { headers:{'Cache-Control':'no-store'} });
      attempts.push(`gateway-fast(original): ${r.error}`);
    } catch (e) { attempts.push(`gateway-fast(original): ${e?.message || 'request failed'}`); }

    // 2) Same fast mode with a canonical 1024terabox.com share URL.
    try {
      const r = await tryHostedGateway(gateway, canonicalShareUrl(link), ndus, controller.signal, false);
      if (r.ok) return Response.json({ success:true, files:r.files, file_count:r.files.length, source:r.source + '-canonical', authenticated:true }, { headers:{'Cache-Control':'no-store'} });
      attempts.push(`gateway-fast(canonical): ${r.error}`);
    } catch (e) { attempts.push(`gateway-fast(canonical): ${e?.message || 'request failed'}`); }

    // 3) Only then ask the gateway for a fully resolved PCS link.
    try {
      const r = await tryHostedGateway(gateway, canonicalShareUrl(link), ndus, controller.signal, true);
      if (r.ok) return Response.json({ success:true, files:r.files, file_count:r.files.length, source:r.source + '-canonical', authenticated:true }, { headers:{'Cache-Control':'no-store'} });
      attempts.push(`gateway-resolved(canonical): ${r.error}`);
    } catch (e) { attempts.push(`gateway-resolved(canonical): ${e?.message || 'request failed'}`); }

    // 4) Last fallback: current unified worker, with the same authenticated cookie.
    try {
      const r = await tryWorker(worker, surl, ndus, controller.signal);
      if (r.ok) return Response.json({ success:true, files:r.files, file_count:r.files.length, source:r.source, authenticated:true }, { headers:{'Cache-Control':'no-store'} });
      attempts.push(`worker: ${r.error}`);
    } catch (e) { attempts.push(`worker: ${e?.message || 'request failed'}`); }

    return Response.json({
      error:'TeraBox could not resolve this share with the authenticated session. The NDUS may be expired, the share may need verification, or TeraBox may be blocking the current resolver.',
      details: attempts.slice(0,4)
    }, { status:502 });
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'TeraBox resolver timed out.' : 'TeraBox resolver is unreachable right now.';
    return Response.json({ error:msg, details:attempts.slice(0,4) }, { status:502 });
  } finally { clearTimeout(timer); }
};
