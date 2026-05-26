"""RERA deadline tracker — smoke tests."""

from datetime import date

from backend.app.services.rera_deadline_tracker import (
    MilestoneStatus,
    MilestoneType,
    build_deadline_tracker,
    build_rera_milestones,
    calculate_projected_date,
)


def test_1_overdue_rera_60pct():
    milestones = build_rera_milestones(
        current_completion_pct=65.0,
        contract_price_aed=3_500_000,
        project_start_date="2023-01-01",
        expected_completion_date="2026-12-31",
        completion_rate_per_month=3.5,
        today="2026-05-26",
        existing_completions={
            "rera_30pct": "2024-06-01",
            "rera_50pct": "2025-01-10",
        },
    )
    r60 = next(m for m in milestones if m.milestone_type == MilestoneType.RERA_60.value)
    assert r60.status == MilestoneStatus.OVERDUE.value
    assert r60.is_overdue is True
    assert r60.priority == "critical"

    report = build_deadline_tracker(
        {
            "rera_registration_number": "RERA-TEST",
            "current_completion_pct": 65.0,
            "contract_price_aed": 3_500_000,
            "project_start_date": "2023-01-01",
            "expected_completion_date": "2026-12-31",
            "existing_completions": {
                "rera_30pct": "2024-06-01",
                "rera_50pct": "2025-01-10",
            },
            "today": "2026-05-26",
        }
    )
    assert report.overdue_count >= 1
    assert len(report.critical_alerts) > 0


def test_2_projected_date_80pct():
    projected = calculate_projected_date(65.0, 80.0, 5.0, "2026-05-26")
    assert projected is not None
    proj_d = date.fromisoformat(projected)
    expected = date(2026, 5, 26) + __import__("datetime").timedelta(days=3.0 * 30.44)
    assert abs((proj_d - expected).days) <= 2


def test_3_fta_vat_q1_overdue():
    report = build_deadline_tracker(
        {
            "rera_registration_number": "RERA-TEST",
            "current_completion_pct": 40.0,
            "contract_price_aed": 1_000_000,
            "project_start_date": "2023-01-01",
            "expected_completion_date": "2026-12-31",
            "existing_completions": {},
            "today": "2026-05-26",
        }
    )
    q1 = next(m for m in report.milestones if m.milestone_type == MilestoneType.FTA_VAT_Q1.value)
    assert q1.status == MilestoneStatus.OVERDUE.value
    assert any("OVERDUE: FTA VAT Return" in a for a in report.critical_alerts)


def test_4_mark_complete_reduces_overdue():
    before = build_deadline_tracker(
        {
            "rera_registration_number": "RERA-TEST",
            "current_completion_pct": 65.0,
            "contract_price_aed": 3_500_000,
            "project_start_date": "2023-01-01",
            "expected_completion_date": "2026-12-31",
            "existing_completions": {
                "rera_30pct": "2024-06-01",
                "rera_50pct": "2025-01-10",
            },
            "today": "2026-05-26",
        }
    )
    after = build_deadline_tracker(
        {
            "rera_registration_number": "RERA-TEST",
            "current_completion_pct": 65.0,
            "contract_price_aed": 3_500_000,
            "project_start_date": "2023-01-01",
            "expected_completion_date": "2026-12-31",
            "existing_completions": {
                "rera_30pct": "2024-06-01",
                "rera_50pct": "2025-01-10",
                "rera_60pct": "2026-05-20",
            },
            "today": "2026-05-26",
        }
    )
    r60_before = next(
        m for m in before.milestones if m.milestone_type == MilestoneType.RERA_60.value
    )
    r60_after = next(
        m for m in after.milestones if m.milestone_type == MilestoneType.RERA_60.value
    )
    assert r60_before.status == MilestoneStatus.OVERDUE.value
    assert r60_after.status == MilestoneStatus.COMPLETED.value
    assert after.overdue_count <= before.overdue_count - 1


def test_5_all_rera_completed():
    completions = {
        "rera_30pct": "2024-06-01",
        "rera_50pct": "2025-01-10",
        "rera_60pct": "2025-08-01",
        "rera_80pct": "2026-01-15",
        "rera_100pct": "2026-04-01",
    }
    report = build_deadline_tracker(
        {
            "rera_registration_number": "RERA-TEST",
            "current_completion_pct": 100.0,
            "contract_price_aed": 2_000_000,
            "project_start_date": "2023-01-01",
            "expected_completion_date": "2026-12-31",
            "existing_completions": completions,
            "today": "2026-05-26",
        }
    )
    rera_ms = [m for m in report.milestones if m.milestone_type.startswith("rera_")]
    assert all(m.status == MilestoneStatus.COMPLETED.value for m in rera_ms)
    assert not any("OVERDUE:" in a and "rera" in a.lower() for a in report.critical_alerts)
