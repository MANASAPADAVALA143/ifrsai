"""
IFRS 16 Multi-Entity Consolidation Engine
Aggregates lease data across entities, applies intercompany eliminations,
and generates group-level disclosures.
"""

from datetime import datetime
import json
import os
import sqlite3

DB_PATH = os.environ.get("IFRS_DB_PATH", "ifrs_config.db")


def init_consolidation_db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_registry (
            entity_id      TEXT PRIMARY KEY,
            entity_name    TEXT NOT NULL,
            parent_id      TEXT,
            currency       TEXT DEFAULT 'INR',
            fx_rate_to_group REAL DEFAULT 1.0,
            is_active      INTEGER DEFAULT 1,
            created_at     TEXT NOT NULL
        )
    """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS lease_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id       TEXT NOT NULL,
            lease_id        TEXT NOT NULL,
            snapshot_data   TEXT NOT NULL,
            snapshot_date   TEXT NOT NULL,
            created_at      TEXT NOT NULL
        )
    """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS intercompany_leases (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            lessor_entity   TEXT NOT NULL,
            lessee_entity   TEXT NOT NULL,
            lease_id        TEXT NOT NULL,
            monthly_amount  REAL NOT NULL,
            created_at      TEXT NOT NULL
        )
    """
    )
    con.commit()
    con.close()


def save_entity(entity_id, entity_name, parent_id=None, currency="INR", fx_rate=1.0):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        INSERT OR REPLACE INTO entity_registry
        (entity_id, entity_name, parent_id, currency, fx_rate_to_group, is_active, created_at)
        VALUES (?,?,?,?,?,1,?)
    """,
        (entity_id, entity_name, parent_id, currency, fx_rate, datetime.utcnow().isoformat()),
    )
    con.commit()
    con.close()


def get_entities(parent_id=None):
    con = sqlite3.connect(DB_PATH)
    if parent_id:
        rows = con.execute(
            "SELECT * FROM entity_registry WHERE parent_id=? AND is_active=1", (parent_id,)
        ).fetchall()
    else:
        rows = con.execute("SELECT * FROM entity_registry WHERE is_active=1").fetchall()
    con.close()
    cols = ["entity_id", "entity_name", "parent_id", "currency", "fx_rate_to_group", "is_active", "created_at"]
    return [dict(zip(cols, r)) for r in rows]


def save_lease_snapshot(entity_id, lease_id, calc_results: dict):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        INSERT INTO lease_snapshots (entity_id, lease_id, snapshot_data, snapshot_date, created_at)
        VALUES (?,?,?,?,?)
    """,
        (
            entity_id,
            lease_id,
            json.dumps(calc_results),
            datetime.utcnow().date().isoformat(),
            datetime.utcnow().isoformat(),
        ),
    )
    con.commit()
    con.close()


def get_latest_snapshots(entity_ids: list) -> list:
    con = sqlite3.connect(DB_PATH)
    results = []
    for entity_id in entity_ids:
        rows = con.execute(
            """
            SELECT entity_id, lease_id, snapshot_data, snapshot_date FROM lease_snapshots
            WHERE entity_id=?
            ORDER BY created_at DESC
        """,
            (entity_id,),
        ).fetchall()
        seen = set()
        for row in rows:
            if row[1] not in seen:
                seen.add(row[1])
                results.append(
                    {
                        "entity_id": row[0],
                        "lease_id": row[1],
                        "data": json.loads(row[2]),
                        "snapshot_date": row[3],
                    }
                )
    con.close()
    return results


def get_intercompany_leases():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute("SELECT * FROM intercompany_leases").fetchall()
    con.close()
    cols = ["id", "lessor_entity", "lessee_entity", "lease_id", "monthly_amount", "created_at"]
    return [dict(zip(cols, r)) for r in rows]


def save_intercompany(lessor, lessee, lease_id, monthly_amount):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        INSERT INTO intercompany_leases (lessor_entity, lessee_entity, lease_id, monthly_amount, created_at)
        VALUES (?,?,?,?,?)
    """,
        (lessor, lessee, lease_id, monthly_amount, datetime.utcnow().isoformat()),
    )
    con.commit()
    con.close()


def consolidate(entity_ids: list, group_currency: str = "INR") -> dict:
    entities = {e["entity_id"]: e for e in get_entities()}
    snapshots = get_latest_snapshots(entity_ids)
    ic_leases = {
        ic["lease_id"]
        for ic in get_intercompany_leases()
        if ic["lessor_entity"] in entity_ids and ic["lessee_entity"] in entity_ids
    }

    entity_summaries = {
        entity_id: {
            "entity_name": entities.get(entity_id, {}).get("entity_name", entity_id),
            "currency": entities.get(entity_id, {}).get("currency", "INR"),
            "fx_rate": entities.get(entity_id, {}).get("fx_rate_to_group", 1.0),
            "leases": [],
            "subtotals": {
                "lease_liability": 0,
                "rou_asset": 0,
                "total_interest": 0,
                "total_depreciation": 0,
            },
        }
        for entity_id in entity_ids
    }
    group_totals = {
        "lease_liability": 0.0,
        "rou_asset": 0.0,
        "total_interest": 0.0,
        "total_depreciation": 0.0,
        "lease_count": 0,
        "eliminated_count": 0,
    }

    for snap in snapshots:
        entity_id = snap["entity_id"]
        lease_id = snap["lease_id"]
        data = snap["data"]
        fx = entities.get(entity_id, {}).get("fx_rate_to_group", 1.0)
        is_ic = lease_id in ic_leases

        lease_entry = {
            "lease_id": lease_id,
            "asset_description": data.get("asset_description", ""),
            "lease_liability_local": data.get("lease_liability", 0),
            "rou_asset_local": data.get("rou_asset", 0),
            "lease_liability_group": data.get("lease_liability", 0) * fx,
            "rou_asset_group": data.get("rou_asset", 0) * fx,
            "is_intercompany": is_ic,
        }
        entity_summaries[entity_id]["leases"].append(lease_entry)

        if not is_ic:
            entity_summaries[entity_id]["subtotals"]["lease_liability"] += data.get("lease_liability", 0) * fx
            entity_summaries[entity_id]["subtotals"]["rou_asset"] += data.get("rou_asset", 0) * fx
            entity_summaries[entity_id]["subtotals"]["total_interest"] += data.get("total_interest", 0) * fx
            group_totals["lease_liability"] += data.get("lease_liability", 0) * fx
            group_totals["rou_asset"] += data.get("rou_asset", 0) * fx
            group_totals["total_interest"] += data.get("total_interest", 0) * fx
            group_totals["lease_count"] += 1
        else:
            group_totals["eliminated_count"] += 1

    return {
        "group_currency": group_currency,
        "entity_count": len(entity_ids),
        "entity_summaries": entity_summaries,
        "group_totals": group_totals,
        "intercompany_eliminated": list(ic_leases),
        "consolidated_at": datetime.utcnow().isoformat(),
    }
