# STRATZ probe output

Raw dumps from `scripts/stratz-probe.mjs --out data/stratz/probe.json`, produced
by the manual "STRATZ probe" workflow.

Nothing here is consumed by the app yet — the site still runs entirely on
OpenDota. This directory exists to answer one question first: **can we reach the
STRATZ API at all, and does it expose anything OpenDota does not?**

Context: `api.stratz.com` is behind Cloudflare bot protection. Plain HTTP
clients (node fetch, curl, python, GitHub runners) receive a "Just a moment..."
challenge rather than data — reproduced from a local dev machine and from the
agent sandbox. Only a real browser passes. If the workflow cannot reach it
either, the browser route in `scripts/stratz-browser-snippet.js` is the only
option left.

The API token is supplied via the `STRATZ_TOKEN` repository secret and is never
written to disk.
