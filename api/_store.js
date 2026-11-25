// Tiny Upstash Redis REST client (no dependencies).
// Works with Vercel's Upstash integration env vars (KV_REST_API_* or UPSTASH_REDIS_REST_*).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const storeReady = Boolean(URL_ && TOKEN);

export async function redis(...cmd) {
  if (!storeReady) return null;
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function logTurn(entry) {
  if (!storeReady) return;
  try {
    await redis('LPUSH', 'chatlog', JSON.stringify(entry));
    await redis('LTRIM', 'chatlog', 0, 4999);
  } catch (e) {
    console.error('log_failed', e.message);
  }
}

// ---- Credit tracking (estimate; Anthropic has no balance API) ----
// Prices in USD per million tokens. Defaults are Claude Sonnet 5.5; override with env vars if the model changes.
const P = {
  in: parseFloat(process.env.PRICE_IN || '2'),
  out: parseFloat(process.env.PRICE_OUT || '10'),
  cacheWrite: parseFloat(process.env.PRICE_CACHE_WRITE || '2.5'),
  cacheRead: parseFloat(process.env.PRICE_CACHE_READ || '0.1')
};

export function costOf(u) {
  if (!u) return 0;
  return ((u.input_tokens || 0) * P.in + (u.output_tokens || 0) * P.out +
    (u.cache_creation_input_tokens || 0) * P.cacheWrite + (u.cache_read_input_tokens || 0) * P.cacheRead) / 1e6;
}

export const dayKey = (d = new Date()) => 'spend:day:' + d.toISOString().slice(0, 10);

export async function recordSpend(usage) {
  if (!storeReady) return;
  try {
    const c = costOf(usage);
    if (!c) return;
    await redis('INCRBYFLOAT', 'spend:total', String(c));
    await redis('INCRBYFLOAT', dayKey(), String(c));
    await redis('EXPIRE', dayKey(), 60 * 60 * 24 * 45);
  } catch (e) {
    console.error('spend_failed', e.message);
  }
}

export async function flagCreditOut(why) {
  if (!storeReady) return;
  try { await redis('SET', 'credit:out', JSON.stringify({ t: Date.now(), why })); } catch (e) { console.error('flag_failed', e.message); }
}
