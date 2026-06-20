'use client';

import { useEffect, useState } from 'react';
import {
  countryForMode,
  countryModeFromForm,
  LeaseFormTabProps,
  type CountryMode,
} from './lease-form-shared';
import { FieldLabelWithExtraction } from './FieldLabelWithExtraction';

const LEASE_TYPES = [
  'Building',
  'Site',
  'Standard',
  'Lease',
  'Commercial',
  'Residential',
  'Equipment',
  'Automobile',
  'Office',
  'Retail',
  'Land',
];

const DEPRECIATION_METHODS = ['Straight Line', 'Declining Balance'];

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'RAK', 'Fujairah', 'Ajman', 'UAQ'];
const FREE_ZONES = [
  'Not applicable',
  'DIFC',
  'JAFZA',
  'DAFZA',
  'ADGM',
  'SAIF Zone',
  'Dubai South',
  'DSO',
  'RAKEZ',
  'AFZA',
];

export function AssetsLocationsTab({
  form,
  setForm,
  markDirty,
  inputClass,
  labelClass,
  extractedConfidences,
  onClearExtractedField,
}: LeaseFormTabProps) {
  const [countryMode, setCountryMode] = useState<CountryMode>(() => countryModeFromForm(form.country));

  useEffect(() => {
    setCountryMode(countryModeFromForm(form.country));
  }, [form.country]);

  const setMode = (mode: CountryMode) => {
    setCountryMode(mode);
    const nextCountry = countryForMode(mode);
    setForm((p) => ({
      ...p,
      country: mode === 'OTHER' && p.country && !['India', 'UK', 'UAE'].includes(p.country) ? p.country : nextCountry,
      ...(mode === 'UAE' ? { currency: p.currency || 'AED', emirate: p.emirate || 'Dubai', freeZone: p.freeZone || 'Not applicable' } : {}),
    }));
    markDirty('assets');
  };

  return (
    <>
      <section className="mb-6">
        <h4 className="text-sm font-medium text-[#64748b] border-b border-[#e2e8f0] pb-2 mb-3">
          Asset details
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <FieldLabelWithExtraction field="leaseType" extractedConfidences={extractedConfidences}>
              Lease type
            </FieldLabelWithExtraction>
            <select
              value={form.leaseType}
              onChange={(e) => {
                setForm((p) => ({ ...p, leaseType: e.target.value }));
                markDirty('assets');
                onClearExtractedField?.('leaseType');
              }}
              className={inputClass}
            >
              {LEASE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <FieldLabelWithExtraction field="assetDescription" extractedConfidences={extractedConfidences}>
              Asset description
            </FieldLabelWithExtraction>
            <input
              type="text"
              value={form.assetDescription}
              onChange={(e) => {
                setForm((p) => ({ ...p, assetDescription: e.target.value }));
                markDirty('assets');
                onClearExtractedField?.('assetDescription');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Contract reference</label>
            <input
              type="text"
              value={form.contractReference}
              onChange={(e) => {
                setForm((p) => ({ ...p, contractReference: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Brand</label>
            <input
              type="text"
              value={form.brand}
              onChange={(e) => {
                setForm((p) => ({ ...p, brand: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
        </div>

        <p className="text-[10px] uppercase tracking-[0.05em] text-[#64748b] font-medium mb-2">Country</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(
            [
              { key: 'UAE' as const, label: '🇦🇪 UAE' },
              { key: 'INDIA' as const, label: '🇮🇳 India' },
              { key: 'UK' as const, label: '🇬🇧 UK' },
              { key: 'OTHER' as const, label: '🌐 Other' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                countryMode === key
                  ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                  : 'bg-white text-[#64748b] border-[#e2e8f0]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {countryMode === 'UAE' && (
          <div className="text-xs text-[#64748b] bg-amber-50 border-l-[3px] border-amber-400 rounded-r-md px-3 py-2 mb-4">
            <span className="font-medium text-[#1e293b]">UAE selected: </span>
            Currency defaults to AED. Emirate + free zone fields shown. IBR benchmark uses UAE market rates.
          </div>
        )}

        {countryMode === 'UAE' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase text-[#64748b]">Emirate *</label>
              <select
                value={form.emirate || 'Dubai'}
                onChange={(e) => {
                  setForm((p) => ({ ...p, emirate: e.target.value }));
                  markDirty('assets');
                }}
                className="text-xs border border-[#e2e8f0] rounded-lg p-2"
              >
                {EMIRATES.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase text-[#64748b]">Area / district</label>
              <input
                type="text"
                placeholder="e.g. Downtown Dubai, DIFC, Business Bay"
                value={form.areaDistrict || ''}
                onChange={(e) => {
                  setForm((p) => ({ ...p, areaDistrict: e.target.value }));
                  markDirty('assets');
                }}
                className="text-xs border border-[#e2e8f0] rounded-lg p-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase text-[#64748b]">Free zone</label>
              <select
                value={form.freeZone || 'Not applicable'}
                onChange={(e) => {
                  setForm((p) => ({ ...p, freeZone: e.target.value }));
                  markDirty('assets');
                }}
                className="text-xs border border-[#e2e8f0] rounded-lg p-2"
              >
                {FREE_ZONES.map((fz) => (
                  <option key={fz}>{fz}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase text-[#64748b]">
                RERA registration no
              </label>
              <input
                type="text"
                placeholder="e.g. DLD-2022-001234"
                value={form.reraRegistrationNo || ''}
                onChange={(e) => {
                  setForm((p) => ({ ...p, reraRegistrationNo: e.target.value }));
                  markDirty('assets');
                }}
                className="text-xs border border-[#e2e8f0] rounded-lg p-2"
              />
              <span className="text-[10px] text-[#64748b]">Dubai Land Dept / RERA number</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {countryMode === 'OTHER' && (
            <div>
              <label className={labelClass}>Country name</label>
              <input
                type="text"
                value={form.country || ''}
                onChange={(e) => {
                  setForm((p) => ({ ...p, country: e.target.value }));
                  markDirty('assets');
                }}
                className={inputClass}
              />
            </div>
          )}
          <div>
            <FieldLabelWithExtraction field="city" extractedConfidences={extractedConfidences}>
              City
            </FieldLabelWithExtraction>
            <input
              type="text"
              value={form.city}
              onChange={(e) => {
                setForm((p) => ({ ...p, city: e.target.value }));
                markDirty('assets');
                onClearExtractedField?.('city');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabelWithExtraction field="location" extractedConfidences={extractedConfidences}>
              Location / address
            </FieldLabelWithExtraction>
            <input
              type="text"
              value={form.location}
              onChange={(e) => {
                setForm((p) => ({ ...p, location: e.target.value }));
                markDirty('assets');
                onClearExtractedField?.('location');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Floor / unit no</label>
            <input
              type="text"
              value={form.floorUnit}
              onChange={(e) => {
                setForm((p) => ({ ...p, floorUnit: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      <details className="mb-6 border border-[#e2e8f0] rounded-lg overflow-hidden">
        <summary className="px-4 py-3 bg-[#f8fafc] text-sm font-medium cursor-pointer">
          Additional details
        </summary>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className={labelClass}>Useful life (months)</label>
            <input
              type="number"
              value={form.usefulLifeMonths}
              onChange={(e) => {
                setForm((p) => ({ ...p, usefulLifeMonths: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Depreciation method</label>
            <select
              value={form.depreciationMethod}
              onChange={(e) => {
                setForm((p) => ({ ...p, depreciationMethod: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            >
              {DEPRECIATION_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>ROU asset GL code</label>
            <input
              type="text"
              value={form.rouGlCode}
              onChange={(e) => {
                setForm((p) => ({ ...p, rouGlCode: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Lease liability GL code</label>
            <input
              type="text"
              value={form.liabilityGlCode}
              onChange={(e) => {
                setForm((p) => ({ ...p, liabilityGlCode: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Interest expense GL code</label>
            <input
              type="text"
              value={form.interestGlCode}
              onChange={(e) => {
                setForm((p) => ({ ...p, interestGlCode: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Depreciation GL code</label>
            <input
              type="text"
              value={form.depreciationGlCode}
              onChange={(e) => {
                setForm((p) => ({ ...p, depreciationGlCode: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
        </div>
      </details>
    </>
  );
}
