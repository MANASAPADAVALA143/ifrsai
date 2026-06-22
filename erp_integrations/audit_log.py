"""Append-only JSONL audit log of every ERP push. Credentials are never stored here."""
import json
import datetime
import pathlib

LOG_PATH = pathlib.Path("erp_push_log.jsonl")


def log_push(
    erp: str,
    lease_id: str,
    journal_type: str,
    payload: dict,
    response: dict,
    success: bool,
    error: str = "",
) -> None:
    entry = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "erp": erp,
        "lease_id": lease_id,
        "journal_type": journal_type,
        "success": success,
        "error": error,
        "erp_reference": response.get("journal_id", ""),
        "payload_summary": {
            "reference_number": payload.get("reference_number"),
            "journal_date": payload.get("journal_date"),
            "line_count": len(payload.get("line_items", [])),
        },
    }
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def read_log(lease_id: str | None = None, limit: int = 50) -> list:
    if not LOG_PATH.exists():
        return []
    entries = []
    with open(LOG_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if lease_id and entry.get("lease_id") != lease_id:
                continue
            entries.append(entry)
    return entries[-limit:]
