'use client';

import { useEffect, useState } from 'react';
import {
  countryForMode,
  countryModeFromForm,
  LeaseFormTabProps,
  type CountryMode,
} from './lease-form-shared';
import { FieldLabelWithExtraction } from './FieldLabelWithExtraction';
import { CollapsibleFormSection, ContextHelpCallout, TintedSectionCard } from './lease-form-ui';

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
      country:
        mode === 'OTHER' && p.country && !['India', 'UK', 'UAE'].includes(p.country)
          ? p.country
          : nextCountry,
      ...(mode === 'UAE'
        ? { currency: p.currency || 'AED', emirate: p.emirate || 'Dubai', freeZone: p.freeZone || 'Not applicable' }
        : {}),
    }));
    markDirty('assets');
  };

  return (
    <>
      <TintedSectionCard
        title="Asset details"
        icon={<span className="text-violet-500">🏢</span>}
        tintClass="bg-violet-50/50"
        borderClass="border-violet-100"
      >
        <ContextHelpCallout>
          <strong>Lease type</strong> and <strong>asset description</strong> drive ROU classification, depreciation
          method defaults, and IBR benchmarking. Required before running Calculate.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          <div>
            <FieldLabelWithExtraction field="leaseType" extractedConfidences={extractedConfidences} required>
              Lease type
            </FieldLabelWithExtraction>
            <select
              value={form.leaseType ?? 'Office'}
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
            <FieldLabelWithExtraction field="assetDescription" extractedConfidences={extractedConfidences} required>
              Asset description
            </FieldLabelWithExtraction>
            <input
              type="text"
              value={form.assetDescription ?? ''}
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
              value={form.contractReference ?? ''}
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
              value={form.brand ?? ''}
              onChange={(e) => {
                setForm((p) => ({ ...p, brand: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
        </div>
      </TintedSectionCard>

      <TintedSectionCard
        title="Country & location"
        icon={<span className="text-emerald-500">📍</span>}
        tintClass="bg-emerald-50/40"
        borderClass="border-emerald-100"
      >
        <p className="text-[10px] uppercase tracking-[0.05em] text-[#64748b] font-semibold mb-2">Country</p>
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
          <ContextHelpCallout variant="tip">
            <span className="font-medium text-[#1e293b]">UAE selected: </span>
            Currency defaults to AED. Emirate and free zone drive IBR benchmark selection and disclosure
            geography. RERA number is required for Dubai real estate leases.
          </ContextHelpCallout>
        )}

        {countryMode === 'UAE' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-gray-800">
                Emirate <span className="text-[#DC2626] font-bold text-sm">*</span>
              </label>
              <select
                value={form.emirate || 'Dubai'}
                onChange={(e) => {
                  setForm((p) => ({ ...p, emirate: e.target.value }));
                  markDirty('assets');
                }}
                className={inputClass}
              >
                {EMIRATES.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass}>Area / district</label>
              <input
                type="text"
                placeholder="e.g. Downtown Dubai, DIFC, Business Bay"
                value={form.areaDistrict ?? ''}
                onChange={(e) => {
                  setForm((p) => ({ ...p, areaDistrict: e.target.value }));
                  markDirty('assets');
                }}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass}>Free zone</label>
              <select
                value={form.freeZone || 'Not applicable'}
                onChange={(e) => {
                  setForm((p) => ({ ...p, freeZone: e.target.value }));
                  markDirty('assets');
                }}
                className={inputClass}
              >
                {FREE_ZONES.map((fz) => (
                  <option key={fz}>{fz}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelClass}>RERA registration no</label>
              <input
                type="text"
                placeholder="e.g. DLD-2022-001234"
                value={form.reraRegistrationNo ?? ''}
                onChange={(e) => {
                  setForm((p) => ({ ...p, reraRegistrationNo: e.target.value }));
                  markDirty('assets');
                }}
                className={inputClass}
              />
              <span className="text-[10px] text-[#64748b]">Dubai Land Dept / RERA number</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          {countryMode === 'OTHER' && (
            <div>
              <label className={labelClass}>Country name</label>
              <input
                type="text"
                value={form.country ?? ''}
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
              value={form.city ?? ''}
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
              value={form.location ?? ''}
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
              value={form.floorUnit ?? ''}
              onChange={(e) => {
                setForm((p) => ({ ...p, floorUnit: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
        </div>
      </TintedSectionCard>

      <CollapsibleFormSection
        title="Additional asset accounting details"
        subtitle="GL codes, useful life & depreciation method"
        tintClass="bg-slate-50"
      >
        <ContextHelpCallout>
          These fields improve downstream accounting exports and fixed asset reporting. Leave blank if your chart of
          accounts is not mapped yet.
        </ContextHelpCallout>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className={labelClass}>Useful life (months)</label>
            <input
              type="number"
              value={form.usefulLifeMonths ?? ''}
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
              value={form.depreciationMethod ?? 'Straight Line'}
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
              value={form.rouGlCode ?? ''}
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
              value={form.liabilityGlCode ?? ''}
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
              value={form.interestGlCode ?? ''}
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
              value={form.depreciationGlCode ?? ''}
              onChange={(e) => {
                setForm((p) => ({ ...p, depreciationGlCode: e.target.value }));
                markDirty('assets');
              }}
              className={inputClass}
            />
          </div>
        </div>
      </CollapsibleFormSection>
    </>
  );
}
