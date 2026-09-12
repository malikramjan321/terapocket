const ALLOWED_HOSTS = [
  'terabox.com', '1024terabox.com', 'teraboxapp.com', 'teraboxlink.com',
  '1024tera.com', 'terabox.app', 'terabox.fun', 'teraboxlink.com'
];

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

function normalizeFile(file = {}) {
  const downloadUrl =
    file.download_url ||
    file.proxy_url ||
    file.direct_link ||
    file.dlink ||
    file.url ||
    '';

  return {
    file_name: file.file_name || file.name || file.server_filename || file.title || 'TeraBox file',
    file_size: file.size || file.file_size || file.size_text || '',
    size_bytes: Number.isFinite(Number(file.size_bytes)) ? Number(file.size_bytes) : null,
    thumbnail: file.thumbnail || file.thumb || file.image || '',
    download_link: downloadUrl,
    streaming_url: file.streaming_url || file.stream_url || '',
  };
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

  // Free public Cloudflare Worker API. Override in Netlify with TERABOX_API_BASE if needed.
  const apiBase = (Netlify.env.get('TERABOX_API_BASE') ||
    'https://terabox-worker.robinkumarshakya103.workers.dev').replace(/\/$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const upstreamUrl = `${apiBase}/api?url=${encodeURIComponent(link)}`;
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TeraPocket/2.0'
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json({ error: 'The resolver returned an invalid response.' }, { status: 502 });
    }

    if (!upstream.ok || data?.success === false) {
      return Response.json(
        { error: data?.error || data?.message || `Resolver error (${upstream.status})` },
        { status: 502 }
      );
    }

    const rawFiles = Array.isArray(data?.files)
      ? data.files
      : data?.file
        ? [data.file]
        : Array.isArray(data)
          ? data
          : [data];

    const files = rawFiles
      .map(normalizeFile)
      .filter((file) => /^https:\/\//i.test(file.download_link));

    if (!files.length) {
      return Response.json({ error: 'No downloadable file was returned for this share.' }, { status: 502 });
    }

    return Response.json(
      {
        success: true,
        files,
        file_count: files.length,
        source: 'resolver'
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
      ? 'The resolver timed out. Please try again.'
      : 'The resolver service is unreachable right now.';
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};
