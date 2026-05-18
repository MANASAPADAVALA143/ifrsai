import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
head = (ROOT / "scripts/_revrec_head.tsx").read_text(encoding="utf-8")
tail = (ROOT / "scripts/revrec_return_fragment.tsx").read_text(encoding="utf-8")

tail = re.sub(r"\[\[\[(\w+)\]\]\]>", r"<\1>", tail)
tail = re.sub(r"\[\[\[(\w+)\]\]\](?=\s)", r"<\1", tail)
tail = re.sub(r"\[\[\[/(\w+)\]\]\]", r"</\1>", tail)
# Fragment placeholders may have used motionFormGrid as tag name — normalize to div
tail = tail.replace("motionFormGrid", "div")

out = head + tail
out_path = ROOT / "frontend/src/pages/r2r/RevRecReconciliationPage.tsx"
out_path.write_text(out, encoding="utf-8")
print("Wrote", out_path, "lines", len(out.splitlines()))
