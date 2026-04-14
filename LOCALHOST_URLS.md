# IFRS.ai Localhost URLs

## Main application

**Frontend (Next.js)** — default `npm run dev` in `frontend` uses **port 3004**:

```
http://localhost:3004
```

**Alternate:** `npm run dev:localhost` uses port **3003**; `npm run dev:3002` uses **3002**.

---

## Backend

**API (FastAPI):**

```
http://localhost:9000
```

**Docs:** http://localhost:9000/api/docs  

**Health:** http://localhost:9000/api/health  

If 9000 is busy, `python app.py` picks the next free port and writes `api_dev_port.txt` in the project root; the Next.js dev proxy reads that file.

---

## How to start (recommended Windows)

Double-click **`START_LOCALHOST.bat`** or **`START_BOTH.bat`** — opens **backend + frontend** and uses **3004**.

Or manually:

```bash
# Terminal 1 — project root
python app.py

# Terminal 2 — frontend
cd frontend
npm run dev
```

---

## Quick checklist

- [ ] Backend running (see terminal: `API base: http://127.0.0.1:9000` or another port)
- [ ] Frontend running: terminal shows `Local: http://localhost:3004` (or the port Next chose)
- [ ] Browser: http://localhost:3004
- [ ] If the UI says **API offline**, the Python backend is not running or not ready yet — refresh after it starts

---

## CFO Insights (example)

```
http://localhost:3004/dashboard/ifrs16/cfo-insights
```

---

## Port busy?

Check the Next.js terminal for the actual **Local:** URL. For a fixed alternate port use `npm run dev:3000` or `dev:localhost` from `frontend/package.json`.
