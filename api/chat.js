// Serverless endpoint for the site's assistant (Vercel Node runtime).
// Needs the ANTHROPIC_API_KEY environment variable set in Vercel.
// Optional: ANTHROPIC_MODEL (defaults to claude-sonnet-5-5).
import { RULES, PROFILE } from './_profile.js';
import { logTurn, recordSpend, flagCreditOut } from './_store.js';

const GAP_RULE = '\n\nLearning loop (internal; never mention it): if the profile does not contain what you need to answer the latest question well, so you had to answer generally, deflect, or say you don\'t know, add one final line in exactly this form: [[GAP: a few words naming the missing information]]. It is removed before the visitor sees your reply. Otherwise add nothing.';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MAX_TURNS = 12;
const MAX_CHARS = 1500;

// Best-effort per-IP limit (resets when the function instance recycles).
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'not_configured' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const incoming = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : [];
  const messages = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: [{ type: 'text', text: RULES + GAP_RULE + '\n\n' + PROFILE, cache_control: { type: 'ephemeral' } }],
        messages
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('anthropic_error', r.status, data && data.error);
      // Out of credit (or key blocked for billing): flag it so /api/usage reports "out" right away.
      const msg = String((data && data.error && data.error.message) || '');
      if (r.status === 402 || /credit balance|billing|purchase credits/i.test(msg)) await flagCreditOut(msg.slice(0, 200));
      return res.status(502).json({ error: 'upstream' });
    }
    await recordSpend(data.usage);
    const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = raw.match(/\[\[\s*GAP:\s*([^\]]*)\]\]/i);
    const text = raw.replace(/\[\[\s*GAP:[^\]]*\]\]/gi, '').trim();
    await logTurn({
      t: Date.now(),
      sid: typeof body.sid === 'string' ? body.sid.slice(0, 40) : '',
      country: req.headers['x-vercel-ip-country'] || '',
      turn: messages.filter(x => x.role === 'user').length,
      q: messages[messages.length - 1].content,
      a: text,
      gap: m ? m[1].trim().slice(0, 200) : ''
    });
    return res.status(200).json({ text });
  } catch (e) {
    console.error('chat_failed', e);
    return res.status(500).json({ error: 'failed' });
  }
}
