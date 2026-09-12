const ALLOWED_HOSTS = [
  'terabox.app',
  'teraboxshare.com',
  'terabox.com',
  '1024terabox.com',
  'teraboxlink.com',
  'terasharefile.com',
  'terafileshare.com',
  'terasharelink.com',
  '1024tera.com',
  'freeterabox.com',
  'teraboxurl.com'
];

const DEFAULT_PROXY = 'https://tbx-proxy.shakir-ansarii075.workers.dev';

function isAllowedTeraBoxUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function extractSurl(value) {
  const u = new URL(value);
  let surl = u.searchParams.get('surl') || '';
  if (!surl && u.pathname.includes('/s/')) {
    surl = u.pathname.split('/s/')[1]?.split('/')[0] || '';
  }
  surl = decodeURIComponent(surl).trim();
  // TeraBox share links often prefix the short id with "1".
  if (surl.startsWith('1') && surl.length > 1) surl = surl.slice(1);
  return surl;
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = n;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size >= 10 || i === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[i]}`;
}

function pickThumb(file = {}) {
  const thumbs = file.thumbs || file.thumbnail || file.thumb || {};
  if (typeof thumbs === 'string') return thumbs;
  return thumbs.url3 || thumbs.url2 || thumbs.url1 || thumbs.icon || '';
}

function normalizeFile(file = {}, fallback = {}) {
  const sizeBytes = Number(file.size ?? file.file_size ?? fallback.size ?? 0);
  const dlink =
    file.dlink ||
    file.download_link ||
    file.direct_link ||
    file.download_url ||
    fallback.dlink ||
    '';

  return {
    file_name:
      file.server_filename ||
      file.filename ||
      file.name ||
      fallback.name ||
      'TeraBox file',
    file_size: file.size_text || formatBytes(sizeBytes),
    size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
    thumbnail: pickThumb(file) || pickThumb(fallback),
    download_link: typeof dlink === 'string' ? dlink : '',
    fs_id: String(file.fs_id || file.fid || fallback.fid || ''),
  };
}

function filesFromPayload(payload = {}) {
  const root = payload?.data ?? payload?.upstream ?? payload;
  const candidates = [];

  if (Array.isArray(root)) candidates.push(...root);
  if (Array.isArray(root?.list)) candidates.push(...root.list);
  if (Array.isArray(root?.files)) candidates.push(...root.files);

  // Simplified proxy response for a single file.
  if (!candidates.length && root && typeof root === 'object') {
    const looksLikeFile = root.dlink || root.name || root.server_filename || root.fid || root.fs_id;
    if (looksLikeFile) candidates.push(root);
  }

  return candidates.map((f) => normalizeFile(f, root));
}

async function callProxy(proxyBase, params, ndus, signal) {
  const url = new URL(proxyBase.replace(/\/$/, '') + '/');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'TeraPocket/3.0 (+Netlify)'
  };
  if (ndus) headers.Cookie = `ndus=${ndus}`;

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal,
    redirect: 'follow'
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  return { response, data, text };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const link = String(body?.link || '').trim();
  if (!isAllowedTeraBoxUrl(link)) {
    return Response.json(
      { error: 'Please use a supported HTTPS TeraBox share link.' },
      { status: 400 }
    );
  }

  const surl = extractSurl(link);
  if (!surl) {
    return Response.json({ error: 'Could not read the TeraBox share ID from this link.' }, { status: 400 });
  }

  const proxyBase = (Netlify.env.get('TERABOX_PROXY_BASE') || DEFAULT_PROXY).trim();
  const ndus = (Netlify.env.get('TERABOX_NDUS') || '').trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);

  try {
    // 1) Recommended fast resolve mode.
    let { response, data } = await callProxy(
      proxyBase,
      { mode: 'resolve', surl },
      ndus,
      controller.signal
    );

    // 2) If the simplified response fails, retry once with raw upstream data.
    if (!response.ok || data?.error) {
      const retry = await callProxy(
        proxyBase,
        { mode: 'resolve', surl, raw: 1, refresh: 1 },
        ndus,
        controller.signal
      );
      response = retry.response;
      data = retry.data;
    }

    if (!response.ok || !data) {
      const detail = data?.error || data?.message || `Gateway error (${response.status})`;
      return Response.json({ error: detail }, { status: 502 });
    }

    if (data?.error) {
      return Response.json({ error: data.error, code: data.code || '' }, { status: 502 });
    }

    const files = filesFromPayload(data);
    const downloadable = files.filter((file) => /^https:\/\//i.test(file.download_link));

    if (!downloadable.length) {
      const hasMetadata = files.length > 0;
      const message = !ndus && hasMetadata
        ? 'File info was found, but no working download link was returned. Add TERABOX_NDUS in Netlify Environment variables for authenticated TeraBox downloads.'
        : 'The gateway found no downloadable file for this share.';
      return Response.json(
        {
          error: message,
          needs_ndus: !ndus,
          metadata_found: hasMetadata,
          source: data?.source || 'gateway'
        },
        { status: 502 }
      );
    }

    return Response.json(
      {
        success: true,
        files: downloadable,
        file_count: downloadable.length,
        source: data?.source || 'gateway',
        authenticated: Boolean(ndus)
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? 'TeraBox gateway timed out. Please try again.'
      : 'TeraBox gateway is unreachable right now.';
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};
