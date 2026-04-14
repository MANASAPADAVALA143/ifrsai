# Why "Backend Offline" & How to Send This App to a Client

## Why It Shows "Backend Offline" Every Time

The app has **two separate processes**:

| Process   | What it does              | Port | How to start        |
|----------|---------------------------|------|---------------------|
| **Backend**  | Python API (calculations, uploads) | 9000 | `python app.py` (from project root) |
| **Frontend** | Next.js UI (what you see in the browser) | 3003 | `npm run dev:localhost` (from `frontend` folder) |

The UI calls the backend at `http://localhost:9000`. If the **backend is not running**, the app correctly shows **"Backend Offline"**. That happens when:

- You only started the frontend (or only opened the browser).
- You closed the window/terminal where `python app.py` was running.
- You restarted your PC and didn’t start the backend again.

**Fix:** Start **both** every time you use the app. Easiest way:

- Double‑click **`START_BOTH.bat`** in the project root.  
- Keep **both** CMD windows open (Backend + Frontend). Closing the Backend window will make the app show "Backend Offline" again.

---

## How to Send This App to a Client

You have two main options.

### Option A: Client Runs It on Their PC (same as you do)

**Give the client:**

1. The whole project folder (or a ZIP of it).
2. **Prerequisites on their machine:**
   - **Node.js** (LTS) – for the frontend  
   - **Python 3.10+** – for the backend  
   - **npm** (comes with Node)

**Instructions for the client:**

1. Unzip (if needed) and open the project folder.
2. Install once:
   - Backend: open CMD in project root → `pip install -r requirements.txt`
   - Frontend: open CMD in `frontend` → `npm install`
3. To use the app: double‑click **`START_BOTH.bat`** and keep both windows open.
4. Open browser to **http://localhost:3004**.

You can copy this into a short “Quick start” doc or email for the client.

**Optional:** Put `START_BOTH.bat` on their desktop (as a shortcut) so they don’t have to open the folder every time.

---

### Option B: Deploy So Client Uses a URL (no “Backend Offline” on their side)

Then the client only opens a link in the browser; you don’t send them the code or ask them to run backend/frontend.

**Rough steps:**

1. **Backend (Python API)**  
   - Deploy to a host that runs Python (e.g. **Render**, **Railway**, **Fly.io**, or a VPS).  
   - Set env vars (e.g. `ANTHROPIC_API_KEY` if you use it).  
   - Note the public API URL (e.g. `https://your-app-name.onrender.com`).

2. **Frontend (Next.js)**  
   - Deploy to **Vercel** (or Netlify).  
   - In the project’s environment variables, set:
     - `NEXT_PUBLIC_API_URL` = your backend URL (e.g. `https://your-app-name.onrender.com`).  
   - Build and deploy. Vercel will give you a URL like `https://your-project.vercel.app`.

3. **Give the client:**  
   - The frontend URL only. They open it in the browser; no “Backend Offline” as long as the backend is deployed and running.

**CORS:** Your `app.py` already allows specific origins. Add your **deployed frontend URL** (e.g. `https://your-project.vercel.app`) to the `allow_origins` list in `app.py` before deploying the backend.

---

## Summary

- **“Backend Offline” every time** = backend process is not running. Use **`START_BOTH.bat`** and keep both windows open.
- **Send to client (their PC):** Send project + **`START_BOTH.bat`** + the short “run both, then open http://localhost:3004” instructions above.
- **Send to client (just a link):** Deploy backend and frontend, set `NEXT_PUBLIC_API_URL`, then give the client only the frontend URL.
