  return (
    <SidebarLayout
      pageTitle="Rev Rec Reconciliation"
      pageSubtitle="IFRS 15 month-end — SSP allocation & contract balances"
    >
      [[[div]]] className="space-y-6">
        <StatusPillsRow sspPill={sspPill} balancePill={balancePill} />

        <section className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <CardHeader
            number={7}
            title="SSP Allocation Variance Check"
            subtitle="IFRS 15 para 73-86 — standalone selling price compliance"
          />

          [[[motionFormGrid]]] className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            [[[motionFormGrid]]]>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={inputClass} value={sspForm.period} onChange={(e) => setSspForm((f) => ({ ...f, period: e.target.value }))} />
            [[[/motionFormGrid]]]
            [[[motionFormGrid]]]>
              <label className="block text-xs font-medium text-text-muted mb-1">Contract ID</label>
              <input className={inputClass} value={sspForm.contract_id} onChange={(e) => setSspForm((f) => ({ ...f, contract_id: e.target.value }))} />
            [[[/motionFormGrid]]]
            [[[motionFormGrid]]]>
              <label className="block text-xs font-medium text-text-muted mb-1">Customer name</label>
              <input className={inputClass} value={sspForm.customer_name} onChange={(e) => setSspForm((f) => ({ ...f, customer_name: e.target.value }))} />
            [[[/motionFormGrid]]]
            [[[motionFormGrid]]]>
              <label className="block text-xs font-medium text-text-muted mb-1">Total contract value ($)</label>
              <input type="number" step="0.01" className={inputClass} value={sspForm.total_contract_value} onChange={(e) => setSspForm((f) => ({ ...f, total_contract_value: e.target.value }))} />
            [[[/motionFormGrid]]]
            [[[motionFormGrid]]] className="md:col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-text-muted mb-1">SSP method</label>
              <select className={inputClass} value={sspForm.ssp_method} onChange={(e) => setSspForm((f) => ({ ...f, ssp_method: e.target.value as SspMethod }))}>
                {SSP_METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            [[[/motionFormGrid]]]
          [[[/motionFormGrid]]]

          [[[motionFormGrid]]] className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b">
                  <th className="py-2 pr-2">PO Name</th>
                  <th className="py-2 pr-2">SSP Used ($)</th>
                  <th className="py-2 pr-2">SSP Supported ($)</th>
                  <th className="py-2 pr-2">Allocated ($)</th>
                  <th className="py-2 pr-2">Recognition</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {poRows.map((row) => (
                  <tr key={row.id} className="border-b border-border-default/60">
                    <td className="py-2 pr-2"><input className={inputClass} value={row.po_name} onChange={(e) => updatePo(row.id, { po_name: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input type="number" className={inputClass} value={row.ssp_used} onChange={(e) => updatePo(row.id, { ssp_used: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input type="number" className={inputClass} value={row.ssp_supported} onChange={(e) => updatePo(row.id, { ssp_supported: e.target.value })} /></td>
                    <td className="py-2 pr-2"><input type="number" className={inputClass} value={row.allocated_amount} onChange={(e) => updatePo(row.id, { allocated_amount: e.target.value })} /></td>
                    <td className="py-2 pr-2">
                      <select className={inputClass} value={row.recognition_pattern} onChange={(e) => updatePo(row.id, { recognition_pattern: e.target.value as RecognitionPattern })}>
                        <option value="Over time">Over time</option>
                        <option value="Point in time">Point in time</option>
                      </select>
                    </td>
                    <td className="py-2">
                      <button type="button" className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-30" disabled={poRows.length <= 1} onClick={() => removePoRow(row.id)} aria-label="Remove PO"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          [[[/motionFormGrid]]]

          <button type="button" onClick={addPoRow} className="inline-flex items-center gap-1 text-sm font-semibold text-orange-primary hover:underline mb-4">
            <Plus className="w-4 h-4" /> Add Performance Obligation
          </button>

          <Button onClick={runSspCheck} disabled={sspLoading}>{sspLoading ? 'Running…' : 'Run SSP Check'}</Button>

          {sspResult && (
            [[[motionFormGrid]]] className="mt-6 pt-6 border-t border-border-default space-y-4">
              [[[motionFormGrid]]] className="flex flex-wrap items-center gap-3">
                <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border', sspCompliant ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-red-100 text-red-800 border-red-300')}>
                  {sspCompliant ? <><CheckCircle2 className="w-4 h-4" /> COMPLIANT</> : <><XCircle className="w-4 h-4" /> EXCEPTIONS FOUND</>}
                </span>
                <span className={cn('text-sm font-medium', Math.abs(sspResult.allocation_rounding_diff) >= 0.01 ? 'text-red-600' : 'text-emerald-700')}>
                  Allocation rounding difference: ${formatMoney(sspResult.allocation_rounding_diff)}
                </span>
              [[[/motionFormGrid]]]
              [[[motionFormGrid]]] className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-text-muted border-b bg-slate-50">
                      <th className="p-2">PO Name</th><th className="p-2">SSP Used</th><th className="p-2">SSP Supported</th><th className="p-2">SSP Variance</th>
                      <th className="p-2">Allocated</th><th className="p-2">Correct</th><th className="p-2">Difference</th><th className="p-2">Status</th><th className="p-2">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sspResult.po_results.map((p) => (
                      <tr key={p.po_name} className="border-b">
                        <td className="p-2 font-medium">{p.po_name}</td>
                        <td className="p-2">${formatMoney(p.ssp_used)}</td>
                        <td className="p-2">${formatMoney(p.ssp_supported)}</td>
                        <td className="p-2">${formatMoney(p.ssp_variance)}</td>
                        <td className="p-2">${formatMoney(p.allocated_amount)}</td>
                        <td className="p-2">${formatMoney(p.correct_allocation)}</td>
                        <td className="p-2">${formatMoney(p.allocation_variance)}</td>
                        <td className="p-2"><span className={cn('px-2 py-0.5 rounded text-xs font-semibold border', poStatusStyles(p.po_status))}>{p.po_status}</span></td>
                        <td className="p-2">{p.risk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              [[[/motionFormGrid]]]
              {(sspResult.reallocation_journal?.length ?? 0) > 0 && (
                [[[motionFormGrid]]] className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="font-semibold text-text-primary mb-2">Suggested reallocation journal entry:</p>
                  {sspResult.reallocation_journal.map((j, i) => (
                    [[[motionFormGrid]]] key={i} className="font-mono text-sm mb-3 last:mb-0">
                      <p>Dr {j.dr_account} ${formatMoney(j.amount)}</p>
                      <p>Cr {j.cr_account} ${formatMoney(j.amount)}</p>
                      <p className="font-sans text-xs text-text-muted mt-1">Narrative: {j.narrative}</p>
                    [[[/motionFormGrid]]]
                  ))}
                [[[/motionFormGrid]]]
              )}
              {sspResult.nova_commentary && (
                [[[motionFormGrid]]] className="flex gap-2 text-sm text-blue-800 italic bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{sspResult.nova_commentary}</p>
                [[[/motionFormGrid]]]
              )}
            [[[/motionFormGrid]]]
          )}
        </section>

        <section className="bg-white rounded-[14px] p-6 border border-border-default shadow-card">
          <CardHeader number={8} title="Contract Asset & Liability Tracker" subtitle="IFRS 15 para 116-118 — balance sheet account movements" />
          [[[motionFormGrid]]] className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            [[[motionFormGrid]]]>
              <label className="block text-xs font-medium text-text-muted mb-1">Period</label>
              <input className={inputClass} value={balanceForm.period} onChange={(e) => setBalanceForm((f) => ({ ...f, period: e.target.value }))} />
            [[[/motionFormGrid]]]
            [[[motionFormGrid]]]>
              <label className="block text-xs font-medium text-text-muted mb-1">Prior period</label>
              <input className={inputClass} value={balanceForm.prior_period} onChange={(e) => setBalanceForm((f) => ({ ...f, prior_period: e.target.value }))} />
            [[[/motionFormGrid]]]
          [[[/motionFormGrid]]]
          <BalanceSubsection title="Contract Asset (Unbilled Revenue)" borderClass="border-l-teal-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'revenue_recognised_unbilled', label: 'Revenue recognised — unbilled ($)' }, { key: 'invoiced_this_period', label: 'Invoiced this period ($)' }, { key: 'cancellations_reversed', label: 'Cancellations reversed ($)' }]} values={balanceForm.contract_asset} onChange={(k, v) => setBalanceField('contract_asset', k, v)} />
          <BalanceSubsection title="Deferred Revenue (Contract Liability)" borderClass="border-l-blue-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'new_billings_received', label: 'New billings received ($)' }, { key: 'revenue_recognised', label: 'Revenue recognised ($)' }, { key: 'cancellations_refunded', label: 'Cancellations refunded ($)' }]} values={balanceForm.deferred_revenue} onChange={(k, v) => setBalanceField('deferred_revenue', k, v)} />
          <BalanceSubsection title="Accrued Revenue" borderClass="border-l-amber-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'accruals_raised', label: 'Accruals raised ($)' }, { key: 'accruals_reversed_on_billing', label: 'Accruals reversed on billing ($)', wide: true }]} values={balanceForm.accrued_revenue} onChange={(k, v) => setBalanceField('accrued_revenue', k, v)} />
          <BalanceSubsection title="Trade Receivables" borderClass="border-l-purple-500" fields={[{ key: 'opening_balance', label: 'Opening balance ($)' }, { key: 'invoices_raised', label: 'Invoices raised ($)' }, { key: 'cash_collected', label: 'Cash collected ($)' }, { key: 'bad_debt_written_off', label: 'Bad debt written off ($)' }]} values={balanceForm.trade_receivables} onChange={(k, v) => setBalanceField('trade_receivables', k, v)} />
          <Button onClick={runBalanceTracker} disabled={balanceLoading} className="mt-2">{balanceLoading ? 'Running…' : 'Run Balance Tracker'}</Button>
          {balanceResult && (
            [[[motionFormGrid]]] className="mt-6 pt-6 border-t border-border-default space-y-4">
              <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border', balanceAllOk ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-red-100 text-red-800 border-red-300')}>
                {balanceAllOk ? <><CheckCircle2 className="w-4 h-4" /> All 4 accounts reconciled</> : <><AlertTriangle className="w-4 h-4" /> {balanceResult.overall_status}</>}
              </span>
              [[[motionFormGrid]]] className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AccountMovementCard title="Contract Asset" account={accounts.contract_asset} />
                <AccountMovementCard title="Deferred Revenue" account={accounts.deferred_revenue} />
                <AccountMovementCard title="Accrued Revenue" account={accounts.accrued_revenue} />
                <AccountMovementCard title="Trade Receivables" account={accounts.trade_receivables} />
              [[[/motionFormGrid]]]
              {balanceResult.ifrs15_disclosure_note && (
                [[[motionFormGrid]]] className="relative bg-slate-100 border border-slate-200 rounded-lg p-4">
                  [[[motionFormGrid]]] className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="text-sm font-bold">IFRS 15 Contract Balances Disclosure Note (draft)</h3>
                    <button type="button" onClick={copyDisclosure} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-primary hover:underline shrink-0"><Copy className="w-3.5 h-3.5" /> Copy</button>
                  [[[/motionFormGrid]]]
                  <pre className="text-xs font-mono whitespace-pre-wrap text-text-secondary">{balanceResult.ifrs15_disclosure_note}</pre>
                [[[/motionFormGrid]]]
              )}
              {balanceResult.nova_commentary && (
                [[[motionFormGrid]]] className="flex gap-2 text-sm text-blue-800 italic bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{balanceResult.nova_commentary}</p>
                [[[/motionFormGrid]]]
              )}
            [[[/motionFormGrid]]]
          )}
        </section>
      [[[/motionFormGrid]]]
    </SidebarLayout>
  );
}
