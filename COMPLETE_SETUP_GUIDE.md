# 🚀 Complete Setup Guide - IFRS AI

## ⚠️ Common Issues & Solutions

### Issue 1: Port Already in Use
**Problem:** Port 8000 or 3003 is already occupied  
**Solution:** The `START_EVERYTHING.bat` script automatically kills existing processes

### Issue 2: API Key Not Working
**Problem:** "invalid x-api-key" error  
**Solution:** 
- API key must be in **ROOT** `.env` file (not frontend/.env)
- Format: `ANTHROPIC_API_KEY=sk-ant-api03-...`
- Get key from: https://console.anthropic.com/

### Issue 3: Frontend Won't Start
**Problem:** Connection refused on localhost:3003  
**Solution:** 
- Make sure you're in `frontend` directory
- Run: `npm run dev`
- Wait for "Local: http://localhost:3003" message

### Issue 4: Backend Won't Start
**Problem:** Port 8000 in use or API errors  
**Solution:**
- Kill process: `Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- Check `.env` file has valid API key
- Run: `python app.py`

---

## ✅ Quick Start (Easiest Method)

### Option 1: Use the Batch File (Recommended)
1. **Double-click:** `START_EVERYTHING.bat`
2. Wait for both windows to open
3. Wait for "Ready" messages in both windows
4. Open browser: http://localhost:3003

### Option 2: Manual Start (Two Terminals)

**Terminal 1 - Backend:**
```powershell
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI
python app.py
```
Wait for: `Uvicorn running on http://127.0.0.1:8000`

**Terminal 2 - Frontend:**
```powershell
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend
npm run dev
```
Wait for: `Local: http://localhost:3003`

---

## 📋 Pre-Flight Checklist

Before starting, verify:

- [ ] **Python installed** (check: `python --version`)
- [ ] **Node.js installed** (check: `node --version`)
- [ ] **Dependencies installed:**
  - Backend: `pip install -r requirements.txt`
  - Frontend: `cd frontend && npm install`
- [ ] **API Key configured:**
  - File: `C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\.env`
  - Contains: `ANTHROPIC_API_KEY=sk-ant-api03-...`
- [ ] **Frontend env file exists:**
  - File: `frontend\.env.local`
  - Contains: `NEXT_PUBLIC_API_URL=http://localhost:9000`

---

## 🔧 Troubleshooting Commands

### Check if servers are running:
```powershell
# Check backend (port 8000)
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue

# Check frontend (port 3003)
Get-NetTCPConnection -LocalPort 3003 -ErrorAction SilentlyContinue
```

### Kill processes on ports:
```powershell
# Kill port 8000
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Kill port 3003
Get-NetTCPConnection -LocalPort 3003 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Verify API key:
```powershell
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI
Get-Content .env | Select-String "ANTHROPIC_API_KEY"
```

### Test backend health:
Open browser: http://localhost:9000/api/health
Should show: `{"status":"ok","anthropic_configured":true}`

---

## 📁 File Locations

| File | Location | Purpose |
|------|----------|---------|
| Backend `.env` | `C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\.env` | API key for backend |
| Frontend `.env.local` | `C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend\.env.local` | Frontend config |
| Backend code | `C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\app.py` | Main backend file |
| Frontend code | `C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend\` | Frontend app |

---

## 🎯 Why So Many Issues?

The app has **multiple components** that must work together:

1. **Backend (Python/FastAPI)** - Port 8000
   - Needs API key in `.env`
   - Needs Python dependencies
   - Must be running for file uploads

2. **Frontend (Next.js/React)** - Port 3003
   - Needs Node.js dependencies
   - Must connect to backend
   - Must be running for UI

3. **Both must run simultaneously**
   - If one stops, features break
   - Port conflicts if already running
   - Environment variables must be correct

**Solution:** Use `START_EVERYTHING.bat` - it handles all of this automatically!

---

## ✅ Success Indicators

You'll know everything is working when:

- ✅ Backend terminal shows: `Uvicorn running on http://127.0.0.1:8000`
- ✅ Frontend terminal shows: `Local: http://localhost:3003`
- ✅ Browser at http://localhost:3003 shows the landing page
- ✅ http://localhost:9000/api/health returns `{"status":"ok","anthropic_configured":true}`
- ✅ File upload at `/dashboard/ifrs16` works without errors

---

## 🆘 Still Having Issues?

1. **Close ALL terminals and restart**
2. **Kill all Node.js and Python processes:**
   ```powershell
   Stop-Process -Name node -Force -ErrorAction SilentlyContinue
   Stop-Process -Name python -Force -ErrorAction SilentlyContinue
   ```
3. **Run `START_EVERYTHING.bat` again**
4. **Wait 10-15 seconds for both to fully start**
5. **Check browser console (F12) for errors**

---

**The batch file makes this MUCH easier - just double-click and wait!** 🚀
