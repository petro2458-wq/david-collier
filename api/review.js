// Private review of bot conversations. Needs ADMIN_KEY set in Vercel.
// /api/review?key=...            -> HTML view
// /api/review?key=...&format=json -> JSON (last 500 turns)
import { redis, storeReady } from './_store.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(404).send('Not found');
  if (!storeReady) return res.status(503).send('Storage not connected yet.');
  const n = Math.min(parseInt(req.query.n || '500', 10) || 500, 5000);
  const rows = ((await redis('LRANGE', 'chatlog', 0, n - 1)) || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  if (req.query.format === 'json') return res.status(200).json({ count: rows.length, rows });

  const sessions = new Set(rows.map(r => r.sid)).size;
  const gaps = rows.filter(r => r.gap);
  const item = r => `<div class="t"><div class="m">${esc(new Date(r.t).toLocaleString('en-US', { timeZone: 'America/Denver' }))} · ${esc(r.country || '?')} · visitor ${esc((r.sid || '').slice(0, 6))}${r.gap ? ` · <b class="g">GAP: ${esc(r.gap)}</b>` : ''}</div><div class="q">${esc(r.q)}</div><div class="a">${esc(r.a)}</div></div>`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Bot review</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#F6F5F2;color:#15161B;max-width:820px;margin:0 auto;padding:24px 16px}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:28px}.t{border-top:1px solid #ddd;padding:12px 0}.m{font-size:12px;color:#5A5C68}.q{font-weight:600;margin:4px 0}.a{white-space:pre-wrap;color:#333}.g{color:#3F5F8F}</style>
<h1>Bot review</h1><p>${rows.length} questions from ${sessions} visitors (latest ${rows.length}). ${gaps.length} flagged as gaps.</p>
<h2>Gaps: questions the bot couldn't fully answer</h2>${gaps.map(item).join('') || '<p>None yet.</p>'}
<h2>All questions, newest first</h2>${rows.map(item).join('') || '<p>None yet.</p>'}`);
}
