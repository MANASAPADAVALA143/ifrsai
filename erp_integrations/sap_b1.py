"""
SAP Business One integration via Service Layer REST API.
Service Layer is available in SAP B1 version 9.0+ (on-premise and cloud).
Base URL: https://{server}:50000/b1s/v1/
Auth: Session-based (POST /Login → get B1SESSION cookie)
Journal entry endpoint: POST /JournalEntries

TODO: Implement push_journal_entry() using the B1 JournalEntries schema.
"""


class SAPB1Client:
    def __init__(
        self, server_url: str, company_db: str, username: str, password: str
    ):
        self.server_url = server_url.rstrip("/")
        self.company_db = company_db
        self.username = username
        self.password = password
        self._session_id: str | None = None

    async def push_journal_entry(self, lines: list) -> dict:
        raise NotImplementedError("SAP B1 live push — TODO")
