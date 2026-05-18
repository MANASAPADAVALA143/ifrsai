"""Fix and complete RevRecReconciliationPage.tsx"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "frontend/src/pages/r2r/RevRecReconciliationPage.tsx"
text = p.read_text(encoding="utf-8")
text = text.replace("</motionFormGrid>", "</div>")

marker = '          <motionFormGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">'
if marker not in text:
    marker = '          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">'
if marker not in text:
    marker = "            <motionFormField>"
start = text.index(marker)
head = text[:start]

# tail uses DIV placeholders __DIV__ to avoid accidental replace issues
D = "div"

tail = f'''          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={{inputClass}} value={{sspForm.period}} onChange={{(e) => setSspForm((f) => ({{ ...f, period: e.target.value }}))}} />
            </div>
            <motionFormGrid>
              <label className="block text-xs font-medium text-text-muted mb-1">Contract ID</label>
              <input className={{inputClass}} value={{sspForm.contract_id}} onChange={{(e) => setSspForm((f) => ({{ ...f, contract_id: e.target.value }}))}} />
            </div>
'''
