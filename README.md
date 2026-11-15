# David C. Collier — employer site

A one-page site for prospective employers, plus an AI assistant that answers from David's approved profile. No job-search tracking lives here.

## Files
- `index.html` — the page
- `David_Collier_Resume.pdf` — resume download
- `api/chat.js` — the assistant endpoint (Vercel serverless function)
- `api/_profile.js` — what the assistant knows and its rules. Edit this to change its answers.

## Deploy on Vercel (one time)
1. vercel.com/new → import this GitHub repo. Framework preset: Other. No build command.
2. Settings → Environment Variables → add `ANTHROPIC_API_KEY` (from console.anthropic.com). Optional: `ANTHROPIC_MODEL`.
3. Redeploy. Every push to the main branch deploys automatically.

## Not built yet
- The video (add the file and a `<video>` tag in the hero).
- The "schedule a call" button with text and email alerts to David.
- API credit alerts: set a usage limit and email alert in the Anthropic Console (Settings → Limits) until an automated check exists.
