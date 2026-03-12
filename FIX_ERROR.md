# 🔧 Fix: "Missing script: 'dev'" Error

## ❌ The Problem

You're running `npm run dev` from the **wrong directory**!

```
❌ WRONG: C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI
   (No package.json here!)

✅ CORRECT: C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend
   (package.json is here!)
```

---

## ✅ The Solution

### Option 1: Change Directory First (Recommended)

```bash
# Step 1: Go to frontend folder
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend

# Step 2: Then run npm
npm run dev
```

### Option 2: Use Full Path

```bash
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend && npm run dev
```

### Option 3: Use the Batch File

**Double-click:** `START_FRONTEND.bat`

This automatically navigates to the correct folder and starts the server!

---

## 📁 Directory Structure

```
IFRSAI/
├── app.py                    (Backend - Python)
├── requirements.txt          (Backend dependencies)
├── package.json             ❌ DOESN'T EXIST HERE
│
└── frontend/                 ✅ GO HERE!
    ├── package.json          ✅ Scripts are here!
    ├── app/
    ├── components/
    └── ...
```

---

## 🎯 Correct Commands

### Start Frontend:
```bash
cd frontend
npm run dev
```

### Start Backend:
```bash
# Stay in root directory
python app.py
```

---

## ✅ Quick Test

Run this to verify you're in the right place:

```bash
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend
npm run
```

You should see:
```
Lifecycle scripts included in frontend@0.1.0:
  start
    next start
available via `npm run-script`:
  dev
    next dev -p 3002
  dev:3000
    next dev -p 3000
  build
    next build
  lint
    eslint
```

If you see this, you're in the right directory! ✅

---

## 🚀 Complete Startup Guide

### Terminal 1 - Backend:
```bash
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI
python app.py
```

### Terminal 2 - Frontend:
```bash
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend
npm run dev
```

**Then open:** http://localhost:3002

---

## 💡 Remember

- **Backend** = Run from root (`IFRSAI/`)
- **Frontend** = Run from `frontend/` folder

**Always check your current directory!**

```bash
# See where you are
pwd          # Linux/Mac
cd           # Windows (shows current directory)
```

---

**The error happens because npm looks for `package.json` in the current directory. Make sure you're in the `frontend` folder!** ✅
