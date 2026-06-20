"""Add CalculateStepper and step visibility wrappers to IFRS 15 calculate tab."""
from pathlib import Path

PAGE = Path(__file__).resolve().parents[1] / "app/dashboard/ifrs15/page.tsx"
text = PAGE.read_text(encoding="utf-8")

# Remove unused activeModule state
text = text.replace(
    "  const [activeModule, setActiveModule] = useState<string | null>(null);\n",
    "",
)

# Advance to step 3 after successful calculation
needle = "      setResults(data?.results);\n"
if needle in text and "setCalculateStep(3)" not in text:
    text = text.replace(
        needle,
        needle + "      setCalculateStep(3);\n      setActiveNavId('revenue-calculate');\n",
        1,
    )

# Insert stepper after calculate tab opens
old_calc_open = """        {ifrs15DashTab === 'calculate' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">"""

new_calc_open = """        {ifrs15DashTab === 'calculate' && (
        <>
        <CalculateStepper
          steps={IFRS15_CALCULATE_STEPS}
          currentStep={calculateStep}
          onStepChange={setCalculateStep}
          maxReachableStep={calculateMaxStep}
        />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">"""

if old_calc_open not in text:
    raise SystemExit("calculate tab opener not found")
text = text.replace(old_calc_open, new_calc_open, 1)

# Close fragment before calculate tab ends
old_calc_close = """      </div>
        )}

      </ModuleWorkspaceLayout>"""

new_calc_close = """      </div>
        </>
        )}

      </ModuleWorkspaceLayout>"""

if old_calc_close not in text:
    raise SystemExit("calculate tab close not found")
text = text.replace(old_calc_close, new_calc_close, 1)

# Step 1: upload + checklist
text = text.replace(
    """        <div className="space-y-6">
          {(extractedData as { _realestate_overlay?: Record<string, unknown> })?._realestate_overlay ? (""",
    """        <div className="space-y-6">
          {showCalcStep(1) && (
          <>
          {(extractedData as { _realestate_overlay?: Record<string, unknown> })?._realestate_overlay ? (""",
    1,
)

text = text.replace(
    """            </div>
          )}

          {/* Results - same level of detail as IFRS 16 */}
          {results && (""",
    """            </div>
          )}
          </>
          )}

          {/* Results - same level of detail as IFRS 16 */}
          {results && (showCalcStep(2) || showCalcStep(3) || showCalcStep(4) || showCalcStep(5)) && (""",
    1,
)

# Step 2: POB / allocation
text = text.replace(
    """              {Array.isArray(results?.ssp_allocation_table) && results.ssp_allocation_table.length > 0 && (""",
    """              {showCalcStep(2) && Array.isArray(results?.ssp_allocation_table) && results.ssp_allocation_table.length > 0 && (""",
    1,
)

text = text.replace(
    """              {perfObs.length > 0 && (
                <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                  <h3 className="text-base font-bold text-text-primary mb-4">Revenue per Obligation</h3>""",
    """              {showCalcStep(2) && perfObs.length > 0 && (
                <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                  <h3 className="text-base font-bold text-text-primary mb-4">Revenue per Obligation</h3>""",
    1,
)

# Step 3: calculation results + schedule (wrap revenue engine through vc constraint)
text = text.replace(
    """          {results && (showCalcStep(2) || showCalcStep(3) || showCalcStep(4) || showCalcStep(5)) && (
            <>
              {results?.revenue_engine_result && (""",
    """          {results && (showCalcStep(2) || showCalcStep(3) || showCalcStep(4) || showCalcStep(5)) && (
            <>
              {showCalcStep(3) && results?.revenue_engine_result && (""",
    1,
)

text = text.replace(
    """              {results?.sla_result?.total_penalty > 0 && (""",
    """              {showCalcStep(3) && results?.sla_result?.total_penalty > 0 && (""",
    1,
)

text = text.replace(
    """              {results?.vc_constraint_result && (
                <div className="p-5 bg-white border border-border-default rounded-xl mb-4 shadow-sm">
                  <h3 className="font-bold text-text-primary mb-1">IFRS 15.56–58 — Variable consideration constraint</h3>""",
    """              {showCalcStep(3) && results?.vc_constraint_result && (
                <div className="p-5 bg-white border border-border-default rounded-xl mb-4 shadow-sm">
                  <h3 className="font-bold text-text-primary mb-1">IFRS 15.56–58 — Variable consideration constraint</h3>""",
    1,
)

text = text.replace(
    """              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-6">
                  <h3 className="text-base font-bold text-text-primary">Calculation Results</h3>
                  <p className="text-xs text-text-muted mt-1">IFRS 15 revenue recognition metrics</p>
                </div>""",
    """              {showCalcStep(3) && (
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-6">
                  <h3 className="text-base font-bold text-text-primary">Calculation Results</h3>
                  <p className="text-xs text-text-muted mt-1">IFRS 15 revenue recognition metrics</p>
                </div>""",
    1,
)

# Close calculation results card before SSP (find closing after effective revenue rate section)
# Insert closing paren after calculation results card ends - before SSP allocation
marker = """            </div>
          </div>

              {showCalcStep(2) && Array.isArray(results?.ssp_allocation_table)"""
if marker in text:
    text = text.replace(
        """            </div>
          </div>

              {showCalcStep(2) && Array.isArray(results?.ssp_allocation_table)""",
        """            </div>
          </div>
              )}

              {showCalcStep(2) && Array.isArray(results?.ssp_allocation_table)""",
        1,
    )

text = text.replace(
    """              {/* Revenue Recognition Schedule Table - same style as IFRS 16 amortization */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">""",
    """              {/* Revenue Recognition Schedule Table - same style as IFRS 16 amortization */}
              {showCalcStep(3) && (
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">""",
    1,
)

text = text.replace(
    """            )}
          </div>

              {/* Contract Modifications — IFRS 15.18-21 */}
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-4">
                  <h3 className="text-base font-bold text-text-primary">Contract Modifications</h3>""",
    """            )}
          </div>
              )}

              {/* Contract Modifications — IFRS 15.18-21 */}
              {showCalcStep(4) && (
              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-4">
                  <h3 className="text-base font-bold text-text-primary">Contract Modifications</h3>""",
    1,
)

# Close step 4 before download row
text = text.replace(
    """              {/* Download row - same as IFRS 16 */}
          <div className="flex gap-4">""",
    """              )}

              {/* Download row - same as IFRS 16 */}
              {showCalcStep(5) && (
          <div className="flex gap-4">""",
    1,
)

text = text.replace(
    """            </Button>
          </div>
            </>
          )}
        </div>

        {/* Right column - same structure as IFRS 16 */}""",
    """            </Button>
          </div>
              )}
            </>
          )}
        </div>

        {/* Right column - same structure as IFRS 16 */}""",
    1,
)

# Right column step visibility
text = text.replace(
    """          {results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Performance Obligations Breakdown</h3>""",
    """          {showCalcStep(2) && results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Performance Obligations Breakdown</h3>""",
    1,
)

text = text.replace(
    """          {results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Journal Entries</h3>""",
    """          {showCalcStep(3) && results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Journal Entries</h3>""",
    1,
)

text = text.replace(
    """          {/* AI Insight - dynamic based on results */}
          <div className="bg-gradient-to-br from-orange-light to-orange-light/50 rounded-card p-6 border border-orange-border shadow-card">""",
    """          {/* AI Insight - dynamic based on results */}
          {(showCalcStep(1) || showCalcStep(2) || showCalcStep(3)) && (
          <div className="bg-gradient-to-br from-orange-light to-orange-light/50 rounded-card p-6 border border-orange-border shadow-card">""",
    1,
)

text = text.replace(
    """            </p>
          </div>

          {/* Disclosure Notes - 6 collapsible cards */}
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6 flex items-center justify-between">
              <div>
              <h3 className="text-base font-bold text-text-primary">Disclosure Notes</h3>""",
    """            </p>
          </div>
          )}

          {/* Disclosure Notes - 6 collapsible cards */}
          {showCalcStep(5) && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6 flex items-center justify-between">
              <div>
              <h3 className="text-base font-bold text-text-primary">Disclosure Notes</h3>""",
    1,
)

text = text.replace(
    """            </div>
          </div>
        </div>
      </div>
        </>
        )}""",
    """            </div>
          </div>
          )}
        </div>
      </div>
        </>
        )}""",
    1,
)

PAGE.write_text(text, encoding="utf-8")
print("Stepper wrappers applied to", PAGE)
