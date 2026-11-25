"""
Phase 0 control tests for IFRS 15 accounting controls and security.

Tests run with mocked Supabase so they work in CI without a live database.
Coverage:
  - Contract qualification gate (Tasks 1 & 5)
  - Variable consideration assessment (Task 2)
  - Contract modification self-approval rejection (Task 3)
  - Evidence pack self-approval rejection (Task 4)
  - IFRS 16 cross-firm isolation (Task 5)
  - Staged journal balance check and approval gate (Task 6)
"""

from __future__ import annotations

import sys
import types
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest


def _mock_request(firm_id: str = "firm-a"):
    """Return a minimal FastAPI Request mock with an X-Firm-Id header."""
    req = MagicMock()
    req.headers.get.side_effect = lambda key, default=None: (
        firm_id if key.lower() in ("x-firm-id",) else default
    )
    return req


# ── Helpers to build minimal mock rows ────────────────────────────────────────

def _qual_row(**kwargs):
    base = {
        "id": "qual-1",
        "firm_id": "firm-a",
        "contract_id": "CONT-001",
        "status": "in_progress",
        "preparer_id": "alice",
        "reviewer_id": None,
        "c1_approval": None,
        "c2_rights": None,
        "c3_payment_terms": None,
        "c4_commercial_substance": None,
        "c5_collection_probable": None,
    }
    base.update(kwargs)
    return base


def _mod_row(**kwargs):
    base = {
        "id": "mod-1",
        "company_id": "firm-a",
        "contract_id": "CONT-001",
        "status": "ai_classified",
        "prepared_by": "alice",
        "ai_treatment": "C_catchup",
        "human_treatment_override": None,
        "catch_up_adjustment": None,
    }
    base.update(kwargs)
    return base


def _pack_row(**kwargs):
    base = {
        "id": "pack-1",
        "company_id": "firm-a",
        "period": "2025-01",
        "status": "under_review",
        "prepared_by": "alice",
        "approved_by": None,
    }
    base.update(kwargs)
    return base


def _journal_row(**kwargs):
    base = {
        "id": "jnl-1",
        "firm_id": "firm-a",
        "status": "pending_review",
        "prepared_by": "alice",
        "total_debit": 1000.0,
        "total_credit": 1000.0,
        "lines": [
            {"account": "Contract Asset", "debit": 1000, "credit": 0},
            {"account": "Revenue", "debit": 0, "credit": 1000},
        ],
    }
    base.update(kwargs)
    return base


# ══════════════════════════════════════════════════════════════════════════════
# Task 1 — Contract Qualification Gate
# ══════════════════════════════════════════════════════════════════════════════

class TestContractQualification:
    def test_submit_all_criteria_set_succeeds(self):
        """Submit succeeds when all five IFRS 15.9 criteria are answered."""
        from backend.app.routers.ifrs15_contract_qualification import (
            _all_criteria_set,
            _all_criteria_passed,
        )
        row = _qual_row(
            c1_approval=True,
            c2_rights=True,
            c3_payment_terms=True,
            c4_commercial_substance=True,
            c5_collection_probable=True,
        )
        assert _all_criteria_set(row) is True
        assert _all_criteria_passed(row) is True

    def test_submit_missing_criteria_fails(self):
        """Submit is rejected when any criterion is unanswered."""
        from backend.app.routers.ifrs15_contract_qualification import _all_criteria_set
        row = _qual_row(
            c1_approval=True,
            c2_rights=True,
            c3_payment_terms=None,   # missing
            c4_commercial_substance=True,
            c5_collection_probable=True,
        )
        assert _all_criteria_set(row) is False

    def test_failed_criteria_gives_failed_status(self):
        """A contract where collection is not probable should result in 'failed'."""
        from backend.app.routers.ifrs15_contract_qualification import _all_criteria_passed
        row = _qual_row(
            c1_approval=True,
            c2_rights=True,
            c3_payment_terms=True,
            c4_commercial_substance=True,
            c5_collection_probable=False,  # fails Step 1
        )
        assert _all_criteria_passed(row) is False

    def test_self_approval_rejected(self):
        """Reviewer cannot be the same person as preparer."""
        from backend.app.routers.ifrs15_contract_qualification import approve_qualification, ApproveRequest
        from fastapi import HTTPException
        import asyncio

        row = _qual_row(status="submitted", preparer_id="alice")

        with patch(
            "backend.app.routers.ifrs15_contract_qualification.qualification_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_contract_qualification.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get.return_value = row
            body = ApproveRequest(reviewer_id="alice")  # same as preparer

            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(
                    approve_qualification("qual-1", body, _mock_request())
                )
            assert exc_info.value.status_code == 400
            assert "SELF_APPROVAL_FORBIDDEN" in str(exc_info.value.detail)

    def test_different_reviewer_allowed(self):
        """Approval succeeds when reviewer is different from preparer."""
        from backend.app.routers.ifrs15_contract_qualification import approve_qualification, ApproveRequest
        import asyncio

        row = _qual_row(
            status="submitted",
            preparer_id="alice",
            c1_approval=True,
            c2_rights=True,
            c3_payment_terms=True,
            c4_commercial_substance=True,
            c5_collection_probable=True,
        )
        expected_result = {**row, "status": "passed", "reviewer_id": "bob", "approved_by": "bob"}

        with patch(
            "backend.app.routers.ifrs15_contract_qualification.qualification_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_contract_qualification.is_supabase_configured",
            return_value=True,
        ), patch(
            "backend.app.routers.ifrs15_contract_qualification._require_step1_gate",
            return_value=False,
        ):
            mock_db.get.return_value = row
            mock_db.update.return_value = expected_result
            mock_db.add_audit.return_value = None
            body = ApproveRequest(reviewer_id="bob")
            result = asyncio.run(
                approve_qualification("qual-1", body, _mock_request())
            )
        assert result["result"] == "passed"


# ══════════════════════════════════════════════════════════════════════════════
# Task 2 — Variable Consideration
# ══════════════════════════════════════════════════════════════════════════════

class TestVCAssessment:
    def test_ev_computation_three_scenarios(self):
        """Expected value = sum of (amount × probability) across scenarios."""
        from backend.app.routers.ifrs15_vc_assessment import _compute_ev

        ev = _compute_ev(
            {
                "ev_scenario_high_amount": 1_200_000,
                "ev_scenario_high_prob": 0.25,
                "ev_scenario_base_amount": 1_000_000,
                "ev_scenario_base_prob": 0.50,
                "ev_scenario_low_amount": 800_000,
                "ev_scenario_low_prob": 0.25,
            }
        )
        assert ev is not None
        assert abs(ev - 1_000_000) < 1

    def test_ev_probabilities_must_sum_to_one(self):
        """EV returns None when probabilities do not sum to 1.0."""
        from backend.app.routers.ifrs15_vc_assessment import _compute_ev

        ev = _compute_ev(
            {
                "ev_scenario_high_amount": 100,
                "ev_scenario_high_prob": 0.5,
                "ev_scenario_base_amount": 80,
                "ev_scenario_base_prob": 0.3,
                # low prob missing → sum = 0.8
                "ev_scenario_low_amount": 60,
                "ev_scenario_low_prob": 0.0,
            }
        )
        assert ev is None

    def test_self_approval_rejected(self):
        """Reviewer cannot approve their own VC assessment."""
        from backend.app.routers.ifrs15_vc_assessment import approve_assessment, ApproveRequest
        from fastapi import HTTPException
        import asyncio

        assessment_row = {
            "id": "vc-1",
            "firm_id": "firm-a",
            "status": "submitted",
            "preparer_id": "alice",
            "reviewer_id": None,
            "constraint_applied": False,
            "method": "expected_value",
            "ev_calculated_amount": 1_000_000,
        }
        with patch(
            "backend.app.routers.ifrs15_vc_assessment.vc_assessment_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_vc_assessment.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get.return_value = assessment_row
            body = ApproveRequest(reviewer_id="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(
                    approve_assessment("vc-1", body, _mock_request())
                )
            assert exc_info.value.status_code == 400
            assert "SELF_APPROVAL_FORBIDDEN" in str(exc_info.value.detail)

    def test_submission_requires_commentary(self):
        """Submitting a VC assessment without preparer commentary must fail."""
        from backend.app.routers.ifrs15_vc_assessment import submit_assessment, SubmitRequest
        from fastapi import HTTPException
        import asyncio

        assessment_row = {
            "id": "vc-1", "firm_id": "firm-a", "status": "draft",
            "preparer_id": None, "preparer_commentary": "",
            "constraint_applied": None,
        }
        with patch(
            "backend.app.routers.ifrs15_vc_assessment.vc_assessment_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_vc_assessment.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get.return_value = assessment_row
            body = SubmitRequest(preparer_id="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(
                    submit_assessment("vc-1", body, _mock_request())
                )
            assert exc_info.value.status_code == 422
            assert "MISSING_COMMENTARY" in str(exc_info.value.detail)

    def test_submission_requires_constraint_set(self):
        """Submitting without an explicit constraint decision must fail."""
        from backend.app.routers.ifrs15_vc_assessment import submit_assessment, SubmitRequest
        from fastapi import HTTPException
        import asyncio

        assessment_row = {
            "id": "vc-1", "firm_id": "firm-a", "status": "draft",
            "preparer_id": None, "preparer_commentary": "Some commentary here.",
            "constraint_applied": None,  # not yet set
        }
        with patch(
            "backend.app.routers.ifrs15_vc_assessment.vc_assessment_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_vc_assessment.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get.return_value = assessment_row
            body = SubmitRequest(preparer_id="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(
                    submit_assessment("vc-1", body, _mock_request())
                )
            assert exc_info.value.status_code == 422
            assert "CONSTRAINT_NOT_SET" in str(exc_info.value.detail)


# ══════════════════════════════════════════════════════════════════════════════
# Task 3 — Contract Modification Self-Approval
# ══════════════════════════════════════════════════════════════════════════════

class TestModificationApproval:
    def test_self_approval_blocked(self):
        """The preparer cannot approve their own modification."""
        from backend.app.routers.ifrs15_modifications import approve, ApproveRequest
        from fastapi import HTTPException
        import asyncio

        row = _mod_row(status="ai_classified", prepared_by="alice")
        with patch(
            "backend.app.routers.ifrs15_modifications.mods_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_modifications.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get_mod.return_value = row
            body = ApproveRequest(approved_by="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(approve("mod-1", body))
            assert exc_info.value.status_code == 400
            assert "SELF_APPROVAL_FORBIDDEN" in str(exc_info.value.detail)

    def test_je_post_blocked_without_approval(self):
        """JE posting is blocked when modification status is not 'approved'."""
        from backend.app.routers.ifrs15_modifications import post_je, PostJeRequest
        from fastapi import HTTPException
        import asyncio

        row = _mod_row(status="ai_classified")
        with patch(
            "backend.app.routers.ifrs15_modifications.mods_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_modifications.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get_mod.return_value = row
            body = PostJeRequest(je_date="2025-03-31", actor="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(post_je("mod-1", body))
            assert exc_info.value.status_code == 400

    def test_different_reviewer_can_approve(self):
        """A different user can approve a modification."""
        from backend.app.routers.ifrs15_modifications import approve, ApproveRequest
        import asyncio

        row = _mod_row(status="under_review", prepared_by="alice")
        approved_row = {**row, "status": "approved", "approved_by": "bob", "approved_at": "2025-01-01T00:00:00Z"}
        with patch(
            "backend.app.routers.ifrs15_modifications.mods_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_modifications.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get_mod.return_value = row
            mock_db.update_mod.return_value = approved_row
            mock_db.add_audit.return_value = None
            body = ApproveRequest(approved_by="bob")
            result = asyncio.run(approve("mod-1", body))
        assert result["modification"]["status"] == "approved"


# ══════════════════════════════════════════════════════════════════════════════
# Task 4 — Evidence Pack SOD
# ══════════════════════════════════════════════════════════════════════════════

class TestEvidencePackSOD:
    def test_self_approval_blocked(self):
        """Pack approver cannot be the same as the preparer."""
        from backend.app.routers.ifrs15_evidence_pack import approve_pack
        from fastapi import HTTPException
        import asyncio

        # Find the ApproveRequest model
        import backend.app.routers.ifrs15_evidence_pack as ep_module
        ApproveRequest = ep_module.ApproveRequest  # type: ignore[attr-defined]

        pack = _pack_row(prepared_by="alice")
        with patch.object(
            ep_module, "evidence_pack_db"
        ) as mock_db, patch.object(
            ep_module, "is_supabase_configured", return_value=True
        ):
            mock_db.get.return_value = pack
            body = ApproveRequest(approved_by="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(approve_pack("pack-1", body))
            assert exc_info.value.status_code == 400
            assert "SELF_APPROVAL_FORBIDDEN" in str(exc_info.value.detail)

    def test_different_approver_allowed(self):
        """A different approver succeeds."""
        from backend.app.routers.ifrs15_evidence_pack import approve_pack
        import asyncio
        import backend.app.routers.ifrs15_evidence_pack as ep_module
        ApproveRequest = ep_module.ApproveRequest  # type: ignore[attr-defined]

        pack = _pack_row(prepared_by="alice")
        approved = {**pack, "status": "approved", "approved_by": "bob"}
        with patch.object(ep_module, "evidence_pack_db") as mock_db, patch.object(
            ep_module, "is_supabase_configured", return_value=True
        ):
            mock_db.get.return_value = pack
            mock_db.update_pack.return_value = approved
            body = ApproveRequest(approved_by="bob")
            result = asyncio.run(approve_pack("pack-1", body))
        assert result["pack"]["approved_by"] == "bob"


# ══════════════════════════════════════════════════════════════════════════════
# Task 5 — IFRS 16 Firm Isolation
# ══════════════════════════════════════════════════════════════════════════════

class TestIFRS16FirmIsolation:
    def test_get_portfolio_filters_by_firm_id(self):
        """get_portfolio always passes firm_id to Supabase; firm B cannot see firm A data."""
        from backend.app.services.ifrs16_db import IFRS16DB

        mock_client = MagicMock()
        mock_query = MagicMock()
        mock_client.table.return_value = mock_query
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.neq.return_value = mock_query
        mock_query.order.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.offset.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=[{"id": "lease-1", "firm_id": "firm-a"}])

        db = IFRS16DB()
        db._client = mock_client
        result = db.get_portfolio("firm-a")

        # Verify firm_id filter was applied
        eq_calls = [str(call) for call in mock_query.eq.call_args_list]
        assert any("firm-a" in c for c in eq_calls), "firm_id filter was not applied"

    def test_find_by_business_lease_id_filters_firm(self):
        """find_by_business_lease_id filters by both firm_id and lease_id."""
        from backend.app.services.ifrs16_db import IFRS16DB

        mock_client = MagicMock()
        mock_query = MagicMock()
        mock_client.table.return_value = mock_query
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=[])

        db = IFRS16DB()
        db._client = mock_client
        db.find_by_business_lease_id("firm-b", "LEASE-001")

        eq_calls = mock_query.eq.call_args_list
        called_args = [(c[0][0], c[0][1]) for c in eq_calls]
        assert ("firm_id", "firm-b") in called_args, "firm_id filter missing"
        assert ("lease_id", "LEASE-001") in called_args, "lease_id filter missing"


# ══════════════════════════════════════════════════════════════════════════════
# Task 6 — Staged Journals
# ══════════════════════════════════════════════════════════════════════════════

class TestStagedJournals:
    def test_unbalanced_journal_rejected(self):
        """A journal where debit ≠ credit is rejected with a validation error."""
        from backend.app.routers.ifrs15_staged_journals import _validate_lines

        lines = [
            {"account": "Contract Asset", "debit": 1000, "credit": 0},
            {"account": "Revenue", "debit": 0, "credit": 900},  # intentionally off
        ]
        errors = _validate_lines(lines)
        assert any("balance" in e.lower() for e in errors)

    def test_balanced_journal_passes_validation(self):
        """A correctly balanced journal passes validation."""
        from backend.app.routers.ifrs15_staged_journals import _validate_lines

        lines = [
            {"account": "Contract Asset", "debit": 1000, "credit": 0},
            {"account": "Revenue", "debit": 0, "credit": 1000},
        ]
        errors = _validate_lines(lines)
        assert errors == []

    def test_line_cannot_have_both_debit_and_credit(self):
        """A line with both debit > 0 and credit > 0 is invalid."""
        from backend.app.routers.ifrs15_staged_journals import _validate_lines

        lines = [
            {"account": "Bad Line", "debit": 500, "credit": 500},
        ]
        errors = _validate_lines(lines)
        assert any("cannot have both" in e.lower() for e in errors)

    def test_post_blocked_without_approval(self):
        """Posting a journal that is not in 'approved' status is blocked."""
        from backend.app.routers.ifrs15_staged_journals import post_journal, PostRequest
        from fastapi import HTTPException
        import asyncio

        row = _journal_row(status="pending_review")
        with patch(
            "backend.app.routers.ifrs15_staged_journals.staged_journals_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_staged_journals.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get.return_value = row
            mock_db.claim_for_posting.return_value = None  # CAS fails: not approved
            body = PostRequest(actor="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(post_journal("jnl-1", body, _mock_request()))
            assert exc_info.value.status_code == 400
            assert "JOURNAL_NOT_APPROVED" in str(exc_info.value.detail)

    def test_self_approval_blocked_on_journal(self):
        """Journal approver cannot be the same as the preparer."""
        from backend.app.routers.ifrs15_staged_journals import approve_journal, ApproveRequest
        from fastapi import HTTPException
        import asyncio

        row = _journal_row(status="pending_review", prepared_by="alice")
        with patch(
            "backend.app.routers.ifrs15_staged_journals.staged_journals_db"
        ) as mock_db, patch(
            "backend.app.routers.ifrs15_staged_journals.is_supabase_configured",
            return_value=True,
        ):
            mock_db.get.return_value = row
            body = ApproveRequest(reviewer_id="alice")
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(approve_journal("jnl-1", body, _mock_request()))
            assert exc_info.value.status_code == 400
            assert "SELF_APPROVAL_FORBIDDEN" in str(exc_info.value.detail)

    def test_compute_totals_correct(self):
        """compute_totals returns correct debit and credit sums."""
        from backend.app.services.ifrs15_staged_journals_db import compute_totals

        lines = [
            {"debit": 500, "credit": 0},
            {"debit": 500, "credit": 0},
            {"debit": 0, "credit": 1000},
        ]
        dr, cr = compute_totals(lines)
        assert dr == Decimal("1000")
        assert cr == Decimal("1000")
