// Private credit status for the bot's Anthropic API balance. Needs ADMIN_KEY in Vercel.
// Anthropic has no balance lookup, so this is an estimate: you tell it your balance after each top-up,
// and it subtracts the cost of every bot reply (tokens x price). A failed call for billing flips it to "out".
//
//   /api/usage?key=...                 -> JSON status (what Muse checks)
//   /api/usage?key=...&set=25          -> "I just topped up / my balance is $25": resets the baseline
//   Optional env vars: LOW_USD (default 5), LOW_DAYS (default 10)
import { redis, storeReady, dayKey } from './_store.js';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(404).send('Not found');
  if (!storeReady) return res.status(503).json({ status: 'unknown', alert: true, message: 'Storage is not connected, so credit cannot be tracked.' });

  try {
    if (req.query.set !== undefined) {
      const bal = num(req.query.set);
      const total = num(await redis('GET', 'spend:total'));
      await redis('SET', 'credit:balance', String(bal));
      await redis('SET', 'credit:base', String(total));
      await redis('SET', 'credit:set_at', String(Date.now()));
      await redis('DEL', 'credit:out');
    }
    const [totalRaw, balRaw, baseRaw, setAt, outRaw] = await Promise.all([
      redis('GET', 'spend:total'), redis('GET', 'credit:balance'), redis('GET', 'credit:base'),
      redis('GET', 'credit:set_at'), redis('GET', 'credit:out')
    ]);
    // Average daily spend over the last 7 days that had traffic (days with none are skipped).
    const days = [];
    for (let i = 0; i < 7; i++) days.push(dayKey(new Date(Date.now() - i * 864e5)));
    const vals = (await Promise.all(days.map(d => redis('GET', d)))).map(num).filter(v => v > 0);
    const avgDay = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    const out = outRaw ? JSON.parse(outRaw) : null;
    const hasBal = balRaw !== null && balRaw !== undefined;
    const remaining = hasBal ? num(balRaw) - (num(totalRaw) - num(baseRaw)) : null;
    const daysLeft = remaining !== null && avgDay > 0 ? remaining / avgDay : null;
    const lowUsd = num(process.env.LOW_USD || '5'), lowDays = num(process.env.LOW_DAYS || '10');

    let status = 'ok', message = 'Bot credit looks fine.';
    if (out) {
      status = 'out';
      message = 'The bot is OUT of API credit and visitors are seeing the fallback message. Top up at console.anthropic.com now.';
    } else if (!hasBal) {
      status = 'unset';
      message = 'No balance on file. Tell the site your current balance: /api/usage?key=...&set=AMOUNT';
    } else if (remaining <= 0) {
      status = 'out';
      message = 'Estimated credit is used up. Check console.anthropic.com and top up.';
    } else if (remaining < lowUsd || (daysLeft !== null && daysLeft < lowDays)) {
      status = 'low';
      message = `Bot credit is getting low: about $${remaining.toFixed(2)} left` + (daysLeft !== null ? `, roughly ${Math.floor(daysLeft)} days at the recent rate.` : '.') + ' Top up at console.anthropic.com.';
    }
    return res.status(200).json({
      status, alert: status !== 'ok', message,
      remaining_usd: remaining === null ? null : Math.round(remaining * 100) / 100,
      avg_daily_usd: Math.round(avgDay * 1000) / 1000,
      days_left: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
      balance_set_usd: hasBal ? num(balRaw) : null,
      balance_set_at: setAt ? new Date(num(setAt)).toISOString() : null,
      credit_out: out, estimate: true
    });
  } catch (e) {
    console.error('usage_failed', e.message);
    return res.status(500).json({ status: 'unknown', alert: true, message: 'Credit check failed: ' + e.message });
  }
}
