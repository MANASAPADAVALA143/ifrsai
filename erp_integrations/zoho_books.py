"""
Zoho Books live integration for IFRS 16 journal entry push.
Handles OAuth token exchange, refresh, and journal creation.
"""
import httpx
from datetime import datetime, timedelta
from typing import Optional

ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token"


class ZohoBooksClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        organization_id: str,
        data_centre: str = "com",
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.organization_id = organization_id
        self.base_url = f"https://www.zohoapis.{data_centre}/books/v3"
        self._access_token: Optional[str] = None
        self._token_expiry: Optional[datetime] = None

    async def _ensure_token(self) -> None:
        """Refresh access token if expired or missing."""
        if (
            self._access_token
            and self._token_expiry
            and datetime.utcnow() < self._token_expiry
        ):
            return
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ZOHO_TOKEN_URL,
                data={
                    "refresh_token": self.refresh_token,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "refresh_token",
                },
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
        if "access_token" not in data:
            raise ValueError(f"Zoho token refresh failed: {data}")
        self._access_token = data["access_token"]
        self._token_expiry = datetime.utcnow() + timedelta(
            seconds=data.get("expires_in", 3600) - 60
        )

    async def verify_connection(self) -> dict:
        """Verify connection and return org info. Raises on failure."""
        await self._ensure_token()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/organizations/{self.organization_id}",
                headers={"Authorization": f"Zoho-oauthtoken {self._access_token}"},
                timeout=20,
            )
        data = resp.json()
        if data.get("code") != 0:
            raise ValueError(
                f"Zoho connection error {data.get('code')}: {data.get('message')}"
            )
        org = data.get("organization", {})
        return {
            "org_name": org.get("name", "Unknown"),
            "org_id": org.get("organization_id", self.organization_id),
            "currency": org.get("currency_code", ""),
        }

    async def push_journal(
        self,
        journal_date: str,
        reference_number: str,
        notes: str,
        line_items: list,
    ) -> dict:
        """
        Push a journal entry to Zoho Books.
        Returns the Zoho journal dict on success, raises on failure.
        line_items: list of {account_id, debit_or_credit, amount, description}
        """
        await self._ensure_token()
        payload = {
            "journal_date": journal_date,
            "reference_number": reference_number,
            "notes": notes,
            "line_items": line_items,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/journals",
                params={"organization_id": self.organization_id},
                headers={"Authorization": f"Zoho-oauthtoken {self._access_token}"},
                json=payload,
                timeout=30,
            )
        data = resp.json()
        if data.get("code") != 0:
            raise ValueError(
                f"Zoho Books error {data.get('code')}: {data.get('message')}"
            )
        return data["journal"]
