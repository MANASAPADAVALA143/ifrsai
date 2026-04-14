/**
 * When the calculation API is unreachable: dev builds show setup hints;
 * production builds show customer-safe copy (no python/ports/URLs).
 * Optional: NEXT_PUBLIC_SUPPORT_CONTACT="IT Helpdesk" or "support@company.com"
 */

export function isCustomerFacingBuild(): boolean {
  return process.env.NODE_ENV === 'production';
}

function supportSuffix(): string {
  const c = process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim();
  return c
    ? ` If this continues, contact ${c}.`
    : ' If this continues, contact your administrator.';
}

/** Tooltip, health check, and generic “API down” body text. */
export function getBackendConnectivityMessage(): string {
  if (!isCustomerFacingBuild()) {
    return 'Cannot reach the IFRS calculation API. Start the backend: open a terminal in the project root and run python app.py (leave it running). On Windows you can double-click START_LOCALHOST.bat or START_BOTH.bat instead. Leave NEXT_PUBLIC_API_URL empty in frontend/.env.local so calls go through the Next.js /api proxy; the proxy uses api_dev_port.txt if Python picked a non-9000 port. Then refresh.';
  }
  return `The accounting service is temporarily unavailable. Please try again in a moment.${supportSuffix()}`;
}

/** Compact line for header badges (no raw URLs in production). */
export function getBackendConnectivityShortLabel(): string {
  if (!isCustomerFacingBuild()) {
    return 'API offline — run python app.py (or START_LOCALHOST.bat)';
  }
  const c = process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim();
  return c
    ? `Service unavailable — try again or contact ${c}`
    : 'Service unavailable — try again or contact your administrator';
}

/** 502 proxy body: in dev include backend URL; in prod do not expose infrastructure. */
export function getBackendProxyFailureDetail(backendBaseUrl: string): string {
  if (!isCustomerFacingBuild()) {
    return `Cannot reach IFRS API at ${backendBaseUrl}. Start the backend: python app.py from the project root.`;
  }
  return `The accounting service is temporarily unavailable.${supportSuffix()}`;
}

export function getApiHealthTimeoutMessage(): string {
  if (!isCustomerFacingBuild()) {
    return 'API health check timed out — is python app.py running?';
  }
  return `The accounting service did not respond in time.${supportSuffix()}`;
}
