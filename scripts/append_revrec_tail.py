from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "frontend/src/pages/r2r/RevRecReconciliationPage.tsx"
text = p.read_text(encoding="utf-8").rstrip()

if "Run Balance Tracker" in text:
    print("Already complete")
    raise SystemExit(0)

tail = r'''
            <motionFormGrid>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={inputClass} value={sspForm.period} onChange={(e) => setSspForm((f) => ({ ...f, period: e.target.value }))} />
            </motionFormGrid>
'''

# use real div tags
tail = '''
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={inputClass} value={sspForm.period} onChange={(e) => setSspForm((f) => ({ ...f, period: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Contract ID</label>
              <input className={inputClass} value={sspForm.contract_id} onChange={(e) => setSspForm((f) => ({ ...f, contract_id: e.target.value }))} />
            </motionFormGrid>
'''
