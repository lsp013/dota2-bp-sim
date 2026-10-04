/**
 * OpenDota fetch layer.
 *
 * Deliberately dependency-free (global fetch, Node >=20) so GitHub Actions
 * needs no install step and no API key.
 */

const BASE = 'https://api.opendota.com/api';

/**
 * OpenDota rate-limits hard (observed: 16/127 heroes 429'd at concurrency 4
 * with ~1.2s backoff). Its documented free limit is 60 req/min without a key,
 * i.e. ~1 req/sec sustained. We run 2 workers with a spacer so we stay well
 * under that, and back off for tens of seconds when we do get throttled.
 */
const CONCURRENCY = 2;
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 8000;
/** Minimum gap between request starts, per worker. */
const MIN_REQUEST_GAP_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Global request gate. Serialises the *start* of every request so all workers
 * together cannot exceed the sustained rate OpenDota allows.
 */
let gateChain = Promise.resolve();
let lastStart = 0;

function rateLimit() {
  const next = gateChain.then(async () => {
    const wait = lastStart + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  // Keep the chain alive even if a waiter throws.
  gateChain = next.catch(() => {});
  return next;
}

async function getJson(path, { retries = MAX_RETRIES } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimit();
      const res = await fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': 'dota2-bp-sim/0.1 (+https://github.com)' },
      });
      if (res.status === 429 || res.status >= 500) {
        // Honour Retry-After when OpenDota sends it.
        const ra = Number(res.headers.get('retry-after'));
        const err = new Error(`HTTP ${res.status}`);
        err.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : null;
        throw err;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} (not retryable)`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      const retryable = !/not retryable/.test(err.message);
      if (!retryable || attempt === retries) break;
      // Exponential backoff with jitter so parallel workers desynchronise.
      const wait =
        err.retryAfterMs ??
        RETRY_BASE_MS * 2 ** attempt + Math.random() * 2000;
      if (attempt >= 2) {
        console.warn(`      [retry] ${path} attempt ${attempt + 1}, waiting ${Math.round(wait)}ms (${err.message})`);
      }
      await sleep(wait);
    }
  }
  throw new Error(`GET ${path} failed: ${lastErr?.message}`);
}

export async function fetchHeroes() {
  return getJson('/heroes');
}

export async function fetchPatchList() {
  try {
    const data = await getJson('/constants/patch');
    const arr = Array.isArray(data) ? data : Object.values(data || {});
    return arr
      .filter((p) => p && p.name)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch {
    return [];
  }
}

export async function fetchMatchups(heroId) {
  return getJson(`/heroes/${heroId}/matchups`);
}

/**
 * Run tasks with bounded concurrency, preserving input order.
 * @template T,R
 * @param {T[]} items
 * @param {(item:T, index:number)=>Promise<R>} worker
 * @param {number} [limit]
 * @returns {Promise<Array<{ok:true,value:R}|{ok:false,error:string,item:T}>>}
 */
export async function mapPool(items, worker, limit = CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err.message, item: items[i] };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export { sleep };
