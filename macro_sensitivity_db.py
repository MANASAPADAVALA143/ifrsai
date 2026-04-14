import os
import sqlite3
from datetime import datetime

DB_PATH = os.environ.get("IFRS_DB_PATH", "ifrs_config.db")


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS macro_sensitivity_config (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id                 TEXT    NOT NULL DEFAULT 'default',
            portfolio_type            TEXT    NOT NULL DEFAULT 'all',
            gdp_sensitivity           REAL    NOT NULL,
            unemployment_sensitivity  REAL    NOT NULL,
            interest_rate_sensitivity REAL    NOT NULL,
            effective_from            TEXT    NOT NULL,
            approved_by               TEXT,
            approval_notes            TEXT,
            is_active                 INTEGER NOT NULL DEFAULT 1,
            created_at                TEXT    NOT NULL
        )
    """
    )
    con.commit()
    con.close()


def save_config(tenant_id, portfolio_type, gdp, unemp, rate, approved_by="", notes=""):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "UPDATE macro_sensitivity_config SET is_active=0 WHERE tenant_id=? AND portfolio_type=? AND is_active=1",
        (tenant_id, portfolio_type),
    )
    con.execute(
        """INSERT INTO macro_sensitivity_config
           (tenant_id, portfolio_type, gdp_sensitivity, unemployment_sensitivity,
            interest_rate_sensitivity, effective_from, approved_by, approval_notes, is_active, created_at)
           VALUES (?,?,?,?,?,?,?,?,1,?)""",
        (
            tenant_id,
            portfolio_type,
            gdp,
            unemp,
            rate,
            datetime.utcnow().date().isoformat(),
            approved_by,
            notes,
            datetime.utcnow().isoformat(),
        ),
    )
    con.commit()
    con.close()


def get_active_config(tenant_id="default", portfolio_type="all"):
    con = sqlite3.connect(DB_PATH)
    row = con.execute(
        """SELECT gdp_sensitivity, unemployment_sensitivity, interest_rate_sensitivity,
                  effective_from, approved_by, approval_notes, created_at
           FROM macro_sensitivity_config
           WHERE tenant_id=? AND portfolio_type=? AND is_active=1
           ORDER BY created_at DESC LIMIT 1""",
        (tenant_id, portfolio_type),
    ).fetchone()
    con.close()
    return row


def get_config_history(tenant_id="default", portfolio_type="all"):
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        """SELECT * FROM macro_sensitivity_config
           WHERE tenant_id=? AND portfolio_type=?
           ORDER BY created_at DESC LIMIT 50""",
        (tenant_id, portfolio_type),
    ).fetchall()
    con.close()
    return rows
