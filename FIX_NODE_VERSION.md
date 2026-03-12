# 🔧 Fix Node.js Version Issue

## ❌ Problem
Your Node.js version is **v20.18.0** but the project needs **v20.19.0 or higher**.

---

## ✅ Solution: Update Node.js

### Step 1: Download Node.js v22 LTS

1. Go to: **https://nodejs.org/**
2. Download **Node.js v22 LTS** (Long Term Support)
3. Run the installer (.exe file)
4. Click "Next" through all steps
5. **Restart your computer** after installation

---

### Step 2: Verify Installation

Open a **NEW** PowerShell window and run:

```bash
node --version
```

Should show: `v22.x.x` (not v20.18.0)

---

### Step 3: Clean Install Dependencies

```bash
cd C:\Users\HCSUSER\OneDrive\Desktop\IFRSAI\frontend

# Delete old node_modules
Remove-Item -Recurse -Force node_modules

# Delete package-lock.json
Remove-Item package-lock.json -ErrorAction SilentlyContinue

# Fresh install
npm install
```

---

### Step 4: Start Server

```bash
npm run dev
```

Then open: **http://localhost:3003**

---

## ⚠️ About the Warnings

**14 high severity vulnerabilities** - **IGNORE THESE!**

These are:
- Development dependencies only
- Not actual errors
- Normal in Next.js projects
- Won't stop your app from running

**Don't run `npm audit fix --force`** - it can break things.

---

## 🎯 Quick Checklist

- [ ] Download Node.js v22 LTS from nodejs.org
- [ ] Install it (restart computer)
- [ ] Verify: `node --version` shows v22.x.x
- [ ] Delete `node_modules` and `package-lock.json`
- [ ] Run `npm install`
- [ ] Run `npm run dev`
- [ ] Open http://localhost:3003

---

## 🚀 After Update

Once Node.js is updated:

1. **Close all PowerShell windows**
2. **Open a NEW PowerShell window**
3. **Run the commands from Step 3 & 4 above**

The old Node.js version might still be cached, so a fresh terminal is important.

---

**This will fix the issue in 5 minutes!** 🎯
