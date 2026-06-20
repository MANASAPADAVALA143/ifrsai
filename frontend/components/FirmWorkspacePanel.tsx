'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, ChevronDown, X } from 'lucide-react';
import {
  fetchAvailableFirms,
  getCurrentFirmId,
  getCurrentFirmName,
  switchFirmWorkspace,
  type FirmRecord,
} from '@/lib/firm-workspace';
import { setLeaseRepositoryAuthContext } from '@/lib/lease-repository';

export function FirmWorkspacePanel() {
  const [firmName, setFirmName] = useState('My Workspace');
  const [firmId, setFirmId] = useState('default');
  const [modalOpen, setModalOpen] = useState(false);
  const [firms, setFirms] = useState<FirmRecord[]>([]);
  const [loadingFirms, setLoadingFirms] = useState(false);

  useEffect(() => {
    setFirmName(getCurrentFirmName());
    setFirmId(getCurrentFirmId());
    setLeaseRepositoryAuthContext(getCurrentFirmId());
  }, []);

  const openSwitcher = useCallback(async () => {
    setModalOpen(true);
    setLoadingFirms(true);
    try {
      const list = await fetchAvailableFirms();
      setFirms(list);
    } finally {
      setLoadingFirms(false);
    }
  }, []);

  const initial = (firmName || 'M').charAt(0).toUpperCase();

  return (
    <>
      <div className="mx-3 mb-4 p-3 bg-orange-50 border border-orange-100 rounded-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 truncate">{firmName}</p>
            <p className="text-[10px] text-gray-400 truncate">{firmId}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void openSwitcher()}
          className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-orange-700 hover:text-orange-800 py-1.5 rounded-lg hover:bg-orange-100/80 transition-colors"
        >
          <Building2 className="w-3.5 h-3.5" />
          Switch Workspace
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close workspace switcher"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Switch Workspace</h2>
                <p className="text-xs text-gray-500 mt-0.5">Select a client firm — data is isolated per workspace</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {loadingFirms ? (
                <p className="text-sm text-gray-500 text-center py-8">Loading workspaces…</p>
              ) : firms.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No workspaces found. Run migration 006 in Supabase.</p>
              ) : (
                firms.map((firm) => (
                  <button
                    key={firm.firm_id}
                    type="button"
                    onClick={() => switchFirmWorkspace(firm.firm_id, firm.firm_name)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors hover:bg-orange-50 ${
                      firmId === firm.firm_id
                        ? 'border-orange-400 bg-orange-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{firm.firm_name}</p>
                        <p className="text-xs text-gray-400">
                          {[firm.market, firm.currency].filter(Boolean).join(' · ') || firm.firm_id}
                        </p>
                      </div>
                      {firmId === firm.firm_id && (
                        <span className="text-xs text-orange-600 font-medium shrink-0">Active</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
