"""Fix IFRS 15 page — restore ModuleWorkspaceLayout and remove legacy tab bar."""
from pathlib import Path

PAGE = Path(__file__).resolve().parents[1] / "app/dashboard/ifrs15/page.tsx"
text = PAGE.read_text(encoding="utf-8")

LAYOUT_OPEN = """      <ModuleWorkspaceLayout
        navGroups={IFRS15_NAV_GROUPS}
        activeNavId={activeNavId}
        onNavSelect={handleIfrs15NavSelect}
        mobileNavOpen={mobileNavOpen}
        onMobileNavOpenChange={setMobileNavOpen}
        kpiItems={kpiItems}
        navTitle="IFRS 15 Menu"
      >
"""

PORTFOLIO = "        {ifrs15DashTab === 'portfolio' && ("

# --- 1. Remove broken layout + orphaned activeModule panel + old KPI + tab rows ---
start = text.find("      <ModuleWorkspaceLayout")
if start == -1:
    raise SystemExit("ModuleWorkspaceLayout not found")

port_idx = text.find(PORTFOLIO, start)
if port_idx == -1:
    raise SystemExit("portfolio section not found")

text = text[:start] + LAYOUT_OPEN + "\n" + text[port_idx:]
print("Replaced broken opening through tab rows")

# --- 2. Close ModuleWorkspaceLayout before floating Master Report button ---
close_before = "      {results && (\n        <button\n          type=\"button\"\n          onClick={() => generateMasterReport()}"
if "</ModuleWorkspaceLayout>" not in text:
    idx = text.find(close_before)
    if idx == -1:
        raise SystemExit("master report button not found")
    text = text[:idx] + "      </ModuleWorkspaceLayout>\n\n" + text[idx:]
    print("Added ModuleWorkspaceLayout close")

# --- 3. Remove stray wrapper </div> left from old space-y-4 container ---
text = text.replace(
    "        )}\n      </div>\n\n      </ModuleWorkspaceLayout>",
    "        )}\n\n      </ModuleWorkspaceLayout>",
)
text = text.replace(
    "      </div>\n        )}\n      </div>\n\n      </ModuleWorkspaceLayout>",
    "      </div>\n        )}\n\n      </ModuleWorkspaceLayout>",
)

PAGE.write_text(text, encoding="utf-8")
print("Wrote", PAGE, "chars", len(text))
