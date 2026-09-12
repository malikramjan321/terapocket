# TeraPocket — Netlify PWA

A small iPhone-friendly PWA that resolves supported TeraBox share links through a server-side Netlify Function.

## What changed in v2

- No `TERABOX_NDUS` environment variable is required.
- Uses a free public Cloudflare Worker resolver by default.
- Returns one or multiple downloadable files.
- Uses the resolver's proxied `download_url` instead of opening the TeraBox share page.
- Resolver base can be swapped without editing code by setting `TERABOX_API_BASE` in Netlify.

Default resolver:
`https://terabox-worker.robinkumarshakya103.workers.dev`

## Deploy

1. Push this folder to GitHub.
2. Import the repository into Netlify.
3. Netlify detects `netlify.toml`; no build command is needed.
4. Deploy.
5. On iPhone: open the site in Safari → Share → Add to Home Screen.

## Optional environment variable

`TERABOX_API_BASE`

Only set this if you want to replace the default resolver with a compatible endpoint exposing `GET /api?url=<share-url>`.

## Notes

- Intended for public links and files you are authorized to download.
- The free public resolver is a third-party dependency and may be rate-limited, changed, or unavailable in the future.
- Large file bytes do not pass through Netlify Functions. The function only resolves metadata and a download URL, avoiding Netlify's serverless response-size limits.
