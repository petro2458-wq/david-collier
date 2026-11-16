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
