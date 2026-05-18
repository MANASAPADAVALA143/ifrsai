/**
 * IFRS 15 portfolio snapshots — browser mirror (localStorage).
 * Server list of record: GET /api/ifrs15/portfolio; this repo syncs for offline UX.
 */

const STORAGE_KEY = 'ifrs15_portfolio_repository';

export type IFRS15PortfolioSnapshotRow = {
  id: string;
  name: string;
  created_at: string;
  snapshot: Record<string, unknown>;
};

export function getIfrs15PortfolioRepository(): IFRS15PortfolioSnapshotRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IFRS15PortfolioSnapshotRow[]) : [];
  } catch {
    return [];
  }
}

export function setIfrs15PortfolioRepository(rows: IFRS15PortfolioSnapshotRow[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* ignore quota */
  }
}

export function mergeIfrs15PortfolioFromServer(rows: IFRS15PortfolioSnapshotRow[]): void {
  const local = getIfrs15PortfolioRepository();
  const byId = new Map<string, IFRS15PortfolioSnapshotRow>();
  for (const r of local) {
    if (r?.id) byId.set(r.id, r);
  }
  for (const r of rows) {
    if (r?.id) byId.set(r.id, r);
  }
  setIfrs15PortfolioRepository(Array.from(byId.values()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
}
