"""
Tally Prime integration via Tally Developer Gateway (local HTTP server).
Tally must be running on the client's machine with TDL Gateway enabled.
Gateway typically runs at http://localhost:9000 (configurable).

TODO: Implement push_voucher() method using Tally XML Import Data format.
The existing file export in erp/page.tsx already generates the correct XML —
the live integration just needs to POST that XML to the gateway URL instead
of downloading it.
"""
import httpx


class TallyPrimeClient:
    def __init__(self, gateway_url: str = "http://localhost:9000", company: str = ""):
        self.gateway_url = gateway_url.rstrip("/")
        self.company = company

    async def push_voucher(self, tally_xml: str) -> dict:
        raise NotImplementedError("Tally Prime live push — TODO")
