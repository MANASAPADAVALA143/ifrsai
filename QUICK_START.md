# IFRS AI — Quick Start

## 1. Start both servers

**Option A: Use the batch file (Windows)**
```
START_BOTH.bat
```
Or: `START_EVERYTHING.bat`
This starts backend (port 8000) and frontend (port 3003) in separate windows.

**Option B: Start manually (2 terminals)**

Run these from the **project root** (`IFRSAI`), not from inside `frontend`.

Terminal 1 — Backend (must be in project root):
```bash
python app.py
```

Terminal 2 — Frontend:
```bash
cd frontend
npm run dev
```

**PowerShell:** Use `;` to run two commands, not `then`. If you're already in `frontend`, run:
```powershell
npm run dev
```
For the backend, first go to project root: `cd ..` then `python app.py`.

## 2. Open the app

- **Frontend:** http://localhost:3003  
- **Backend API docs:** http://localhost:9000/api/docs  

## 3. If upload fails with "Failed to fetch"

- The **Backend Offline** badge in the top bar means the API is not reachable.
- Start the backend: `python app.py` from the project root.
- Ensure no firewall is blocking port 8000.

## 4. Environment setup

- Copy `.env.example` to `.env` and add your `ANTHROPIC_API_KEY` for AI extraction.
- Frontend uses `NEXT_PUBLIC_API_URL=http://localhost:9000` (set in `frontend/.env.local` if needed).
