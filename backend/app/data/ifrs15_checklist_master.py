"""IFRS 15 completeness checklist master (audit evidence pack)."""

CHECKLIST = [
    # IDENTIFICATION
    {
        "section": "identification",
        "code": "ID-001",
        "requirement": "All contracts with customers identified and documented",
        "ref": "IFRS 15.9",
    },
    {
        "section": "identification",
        "code": "ID-002",
        "requirement": "Contract combination assessment performed where applicable",
        "ref": "IFRS 15.17",
    },
    {
        "section": "identification",
        "code": "ID-003",
        "requirement": "Contract modification assessment performed for all amendments",
        "ref": "IFRS 15.18-21",
    },
    # PERFORMANCE OBLIGATIONS
    {
        "section": "obligations",
        "code": "OB-001",
        "requirement": "All performance obligations identified per contract",
        "ref": "IFRS 15.22-30",
    },
    {
        "section": "obligations",
        "code": "OB-002",
        "requirement": "Distinct vs non-distinct assessment documented",
        "ref": "IFRS 15.27-28",
    },
    {
        "section": "obligations",
        "code": "OB-003",
        "requirement": "Series of distinct goods/services assessed",
        "ref": "IFRS 15.22(b)",
    },
    {
        "section": "obligations",
        "code": "OB-004",
        "requirement": "Principal vs agent determination made where applicable",
        "ref": "IFRS 15.B34-B38",
    },
    # TRANSACTION PRICE
    {
        "section": "price",
        "code": "TP-001",
        "requirement": "Variable consideration identified and estimated",
        "ref": "IFRS 15.50-54",
    },
    {
        "section": "price",
        "code": "TP-002",
        "requirement": "Constraint on variable consideration applied",
        "ref": "IFRS 15.56-57",
    },
    {
        "section": "price",
        "code": "TP-003",
        "requirement": "Significant financing component assessed",
        "ref": "IFRS 15.60-65",
    },
    {
        "section": "price",
        "code": "TP-004",
        "requirement": "Non-cash consideration measured at fair value",
        "ref": "IFRS 15.66-69",
    },
    # ALLOCATION
    {
        "section": "allocation",
        "code": "AL-001",
        "requirement": "Standalone selling prices determined for all POBs",
        "ref": "IFRS 15.76-80",
    },
    {
        "section": "allocation",
        "code": "AL-002",
        "requirement": "SSP estimation method documented (observable/adjusted/residual)",
        "ref": "IFRS 15.78",
    },
    {
        "section": "allocation",
        "code": "AL-003",
        "requirement": "Discount allocated on relative SSP basis",
        "ref": "IFRS 15.81-83",
    },
    # RECOGNITION
    {
        "section": "recognition",
        "code": "REC-001",
        "requirement": "Over-time vs point-in-time determination documented per POB",
        "ref": "IFRS 15.35-38",
    },
    {
        "section": "recognition",
        "code": "REC-002",
        "requirement": "Progress measure selected and applied consistently",
        "ref": "IFRS 15.39-45",
    },
    {
        "section": "recognition",
        "code": "REC-003",
        "requirement": "Revenue schedules generated and tied to GL",
        "ref": "IFRS 15.31",
    },
    {
        "section": "recognition",
        "code": "REC-004",
        "requirement": "Deferred revenue rollforward prepared",
        "ref": "IFRS 15.105-109",
    },
    {
        "section": "recognition",
        "code": "REC-005",
        "requirement": "Contract assets and liabilities correctly classified",
        "ref": "IFRS 15.105",
    },
    # DISCLOSURE
    {
        "section": "disclosure",
        "code": "DISC-001",
        "requirement": "Disaggregated revenue disclosure prepared",
        "ref": "IFRS 15.114-115",
    },
    {
        "section": "disclosure",
        "code": "DISC-002",
        "requirement": "Contract balances opening/closing reconciliation included",
        "ref": "IFRS 15.116-118",
    },
    {
        "section": "disclosure",
        "code": "DISC-003",
        "requirement": "RPO aggregate amount disclosed (§120)",
        "ref": "IFRS 15.120",
    },
    {
        "section": "disclosure",
        "code": "DISC-004",
        "requirement": "RPO time-band bucketing disclosed",
        "ref": "IFRS 15.120(b)",
    },
    {
        "section": "disclosure",
        "code": "DISC-005",
        "requirement": "Practical expedients applied disclosed",
        "ref": "IFRS 15.121",
    },
    {
        "section": "disclosure",
        "code": "DISC-006",
        "requirement": "Significant judgments and estimates disclosed",
        "ref": "IFRS 15.123-126",
    },
    {
        "section": "disclosure",
        "code": "DISC-007",
        "requirement": "Contract costs (capitalised/amortised) disclosed",
        "ref": "IFRS 15.128-129",
    },
    # UAE REAL ESTATE (conditional)
    {
        "section": "disclosure",
        "code": "UAE-001",
        "requirement": "RERA escrow compliance documented",
        "ref": "UAE RE — RERA Law",
    },
    {
        "section": "disclosure",
        "code": "UAE-002",
        "requirement": "Off-plan revenue recognition method disclosed (input/output)",
        "ref": "IFRS 15.39-45 + RERA",
    },
    # CONTROLS
    {
        "section": "controls",
        "code": "CTRL-001",
        "requirement": "Maker-checker controls in place for revenue journals",
        "ref": "Internal Controls",
    },
    {
        "section": "controls",
        "code": "CTRL-002",
        "requirement": "Billing-to-GL reconciliation performed and signed off",
        "ref": "Internal Controls",
    },
    {
        "section": "controls",
        "code": "CTRL-003",
        "requirement": "Contract modifications reviewed and approved by finance",
        "ref": "Internal Controls",
    },
    {
        "section": "controls",
        "code": "CTRL-004",
        "requirement": "RPO snapshot run and reviewed at period end",
        "ref": "Internal Controls",
    },
    {
        "section": "controls",
        "code": "CTRL-005",
        "requirement": "Manual journal entries reviewed for unusual items",
        "ref": "Internal Controls",
    },
]
