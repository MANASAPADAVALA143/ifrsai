# IFRS AI — Production Deployment

## Architecture

| Component | Host | URL |
|-----------|------|-----|
| Frontend (Next.js) | Vercel | https://ifrsai.vercel.app |
| Backend (Python / FastAPI) | Render | https://ifrsai.onrender.com |

The browser must reach the Python API for uploads, calculations, and AI extraction. Local dev uses the Next.js `/api` proxy; production should call the backend **directly** for long-running requests (PDF extraction can take 1–5 minutes).

---

## Backend (Render)

Repo includes `render.yaml` and `Dockerfile`.

1. Create a **Web Service** on [Render](https://render.com) connected to `MANASAPADAVALA143/ifrsai`.
2. **Build command:** `pip install -r requirements.txt`
3. **Start command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
4. **Environment variables:**

| Variable | Required | Notes |
|----------|----------|-------|
| `ANTHROPIC_API_KEY` | Yes | Claude API for contract extraction |
| `PORT` | Auto | Set by Render |

5. Confirm health: https://ifrsai.onrender.com/api/health  
   Expected: `{"status":"healthy","anthropic_configured":true}`

**Note:** Render free tier sleeps after inactivity. First request after idle may take ~30 seconds (cold start).

---

## Frontend (Vercel)

1. Import repo on [Vercel](https://vercel.com) — **Root Directory:** `frontend`
2. **Required environment variable (Production):**

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_API_URL` | `https://ifrsai.onrender.com` |

No trailing slash. This routes the browser directly to Render and avoids Vercel serverless timeouts on long uploads.

3. **Optional:**

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_SUPPORT_CONTACT` | Shown in API-offline messages, e.g. `IT Helpdesk` |

4. **Do not set** `BACKEND_URL` on Vercel if `NEXT_PUBLIC_API_URL` is set — the direct URL is preferred for uploads.

5. After changing env vars, **Redeploy** (Deployments → ⋯ → Redeploy).

---

## CORS

`app.py` already allows:

- `https://ifrsai.vercel.app`
- `https://ifrs-ai.vercel.app`

Add any new Vercel preview/production domains to `allow_origins` in `app.py` before deploying the backend.

---

## Local development

```powershell
# Option A — double-click
START_LOCALHOST.bat

# Option B — manual (two terminals)
cd <project-root>
python app.py

cd frontend
npm run dev
```

- **App:** http://127.0.0.1:3004  
- **API:** http://127.0.0.1:9000  
- **API docs:** http://127.0.0.1:9000/api/docs  

Leave `NEXT_PUBLIC_API_URL` empty in `frontend/.env.local` so the Next.js proxy handles `/api/*` locally.

---

## Troubleshooting

### "The accounting service is temporarily unavailable" on Vercel

Usually one of:

1. **`NEXT_PUBLIC_API_URL` not set** — Vercel proxy times out on long PDF uploads. Set it to `https://ifrsai.onrender.com` and redeploy.
2. **Render backend sleeping** — Wait ~30s and retry.
3. **`ANTHROPIC_API_KEY` missing on Render** — Upload returns 503; check Render env vars.

### "API offline" badge locally

Start the backend: `python app.py` (or `START_LOCALHOST.bat`). Keep both backend and frontend terminals open.

### Verify production API from browser

Open: https://ifrsai.onrender.com/api/health

Should return JSON with `"status":"healthy"`.
