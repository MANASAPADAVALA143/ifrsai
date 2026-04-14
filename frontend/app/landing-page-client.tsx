'use client';

import Link from 'next/link';
import { CheckCircle, Play } from 'lucide-react';

export function LandingPageClient() {
  return (
    <div className="min-h-screen bg-navy text-text relative overflow-x-hidden">
      {/* Background Orbs */}
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>

      {/* Fixed Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-[5%] h-[72px] flex items-center justify-between bg-navy/80 backdrop-blur-[20px] border-b border-border">
        <Link href="/" className="flex items-center gap-2 font-heading text-xl font-bold text-white">
          <div className="w-2 h-2 bg-emerald rounded-full shadow-[0_0_12px_rgba(0,201,141,1)] animate-pulse"></div>
          IFRS<span className="bg-gradient-to-r from-indigo to-emerald bg-clip-text text-transparent">.ai</span>
        </Link>
        <ul className="hidden md:flex items-center gap-9 list-none">
          <li><Link href="#" className="text-text-muted text-sm font-medium hover:text-text transition-colors">Products</Link></li>
          <li><Link href="#" className="text-text-muted text-sm font-medium hover:text-text transition-colors">Pricing</Link></li>
          <li><Link href="#" className="text-text-muted text-sm font-medium hover:text-text transition-colors">Documentation</Link></li>
          <li><Link href="#" className="text-text-muted text-sm font-medium hover:text-text transition-colors">About</Link></li>
        </ul>
        <div className="flex items-center gap-3">
          <Link href="/login" className="px-5 py-2.5 border border-border bg-transparent text-text rounded-lg text-sm font-medium hover:border-white/20 hover:bg-card-hover transition-all">
            Sign In
          </Link>
          <Link href="/login" className="px-5 py-2.5 bg-indigo text-white rounded-lg text-sm font-semibold hover:bg-indigo-light hover:-translate-y-0.5 transition-all shadow-[0_0_24px_rgba(79,110,247,0.3)]">
            Request Demo
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 pt-40 pb-24 px-[5%] max-w-[1200px] mx-auto grid lg:grid-cols-2 gap-20 items-center">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-emerald/10 border border-emerald/20 rounded-full text-xs font-semibold text-emerald uppercase tracking-wide">
            <div className="w-2 h-2 bg-emerald rounded-full animate-pulse"></div>
            Now live — IFRS 16, 15 & 9
          </div>

          <h1 className="font-heading text-[clamp(42px,5vw,64px)] font-extrabold leading-[1.1] tracking-[-2px] text-white">
            IFRS Compliance,<br />
            <span className="bg-gradient-to-r from-indigo-light to-emerald bg-clip-text text-transparent">
              Automated by AI
            </span>
          </h1>

          <p className="text-lg text-text-muted leading-relaxed font-light max-w-[460px]">
            IFRS 16, 15 & 9 — fully automated. Upload your contract or loan data, get audit-ready reports in 4 minutes.
          </p>

          <div className="flex gap-3.5 flex-wrap">
            <Link href="/login" className="px-8 py-3.5 bg-indigo text-white rounded-[10px] text-[15px] font-semibold hover:-translate-y-0.5 transition-all shadow-[0_0_40px_rgba(79,110,247,0.4)] hover:shadow-[0_8px_50px_rgba(79,110,247,0.6)]">
              Request Demo →
            </Link>
            <Link href="#" className="px-8 py-3.5 bg-transparent text-text border border-border rounded-[10px] text-[15px] font-medium hover:border-white/20 hover:bg-card-hover transition-all flex items-center gap-2">
              <Play className="w-4 h-4" />
              Watch 90-sec demo
            </Link>
          </div>

          <div className="flex items-center gap-3 text-text-muted text-[13px]">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full border-2 border-navy bg-indigo flex items-center justify-center text-white text-[11px] font-bold font-heading">CF</div>
              <div className="w-8 h-8 rounded-full border-2 border-navy bg-emerald flex items-center justify-center text-white text-[11px] font-bold font-heading">RK</div>
              <div className="w-8 h-8 rounded-full border-2 border-navy bg-amber flex items-center justify-center text-white text-[11px] font-bold font-heading">MP</div>
              <div className="w-8 h-8 rounded-full border-2 border-navy bg-red-500 flex items-center justify-center text-white text-[11px] font-bold font-heading">AJ</div>
            </div>
            <span>Trusted by finance teams across India</span>
          </div>
        </div>

        {/* Dashboard Mockup */}
        <div className="relative">
          <div className="bg-navy2 border border-border rounded-2xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.6)] hover:scale-[1.02] transition-transform duration-500">
            <div className="bg-card border-b border-border px-4 py-3 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]"></div>
              <div className="ml-3 bg-white/5 rounded px-3 py-1 text-[11px] text-text-muted flex-1">app.ifrs.ai/dashboard</div>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <div className="bg-card border border-border rounded-[10px] p-3.5">
                  <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Total Lease Liability</div>
                  <div className="font-heading text-base font-bold text-white">₹4.2Cr</div>
                  <div className="text-[10px] text-emerald mt-1">↑ IFRS 16 compliant</div>
                </div>
                <div className="bg-card border border-border rounded-[10px] p-3.5">
                  <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">ROU Assets</div>
                  <div className="font-heading text-base font-bold text-white">₹4.8Cr</div>
                  <div className="text-[10px] text-emerald mt-1">↑ Recognised</div>
                </div>
                <div className="bg-card border border-border rounded-[10px] p-3.5">
                  <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Active Leases</div>
                  <div className="font-heading text-base font-bold text-white">12</div>
                  <div className="text-[10px] text-emerald mt-1">↑ All current</div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-[10px] p-3.5 mb-3.5 h-[100px] flex items-end gap-1.5">
                {[40, 55, 45, 70, 60, 85, 75, 90].map((height, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${height}%`,
                      background:
                        i === 7
                          ? 'linear-gradient(180deg, #00C98D, rgba(0,201,141,0.3))'
                          : 'linear-gradient(180deg, #4F6EF7, rgba(79,110,247,0.3))',
                    }}
                  ></div>
                ))}
              </div>

              <div className="space-y-2">
                {[
                  { icon: '🏢', name: 'HQ Office Lease, Mumbai', amount: '₹1.2Cr', badge: 'Stage 1' },
                  { icon: '🚗', name: 'Fleet Vehicle — 24 units', amount: '₹48.2L', badge: 'Done' },
                  { icon: '💻', name: 'IT Equipment Lease', amount: '₹22.6L', badge: 'Done' },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                    <div className="w-7 h-7 rounded-md bg-indigo/15 flex items-center justify-center text-xs flex-shrink-0">{row.icon}</div>
                    <div className="text-xs text-text flex-1">{row.name}</div>
                    <div className="text-xs font-heading text-indigo-light font-semibold">{row.amount}</div>
                    <div className="text-[10px] px-2 py-0.5 rounded-full bg-emerald/10 text-emerald border border-emerald/20">{row.badge}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 max-w-[1200px] mx-auto px-[5%] pb-20">
        <div className="grid grid-cols-4 gap-px bg-border border border-border rounded-2xl overflow-hidden">
          {[
            { number: '4 min', label: 'Average calculation time' },
            { number: '100%', label: 'IFRS compliant output' },
            { number: '3', label: 'Standards — IFRS 16, 15, 9' },
            { number: '0', label: 'Manual errors vs Excel' },
          ].map((metric, i) => (
            <div key={i} className="bg-navy2 py-8 px-7 text-center">
              <div className="font-heading text-[42px] font-extrabold leading-none mb-2 bg-gradient-to-br from-white to-indigo-light bg-clip-text text-transparent">
                {metric.number}
              </div>
              <div className="text-sm text-text-muted font-normal">{metric.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-[1200px] mx-auto px-[5%] py-20">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-light uppercase tracking-wide mb-4">
          <div className="w-5 h-px bg-indigo-light"></div>
          Process
        </div>
        <h2 className="font-heading text-[clamp(32px,4vw,48px)] font-extrabold leading-[1.15] tracking-[-1.5px] text-white mb-4">
          Three steps to<br />full compliance
        </h2>
        <p className="text-[17px] text-text-muted max-w-[520px] leading-relaxed mb-0">
          From raw lease contract to audit-ready Excel report. No accounting knowledge required.
        </p>

        <div className="grid md:grid-cols-3 gap-px bg-border border border-border rounded-2xl overflow-hidden mt-[60px]">
          {[
            { number: '01', icon: '📄', iconBg: 'blue', title: 'Upload Contract', desc: 'Drag and drop your lease agreement — PDF, DOCX, or paste the text. Any format works.' },
            { number: '02', icon: '🤖', iconBg: 'green', title: 'AI Extracts & Calculates', desc: 'Claude AI reads your contract, extracts all key terms, and runs the full IFRS calculation engine automatically.' },
            { number: '03', icon: '📊', iconBg: 'amber', title: 'Download Report', desc: 'Get a 5-sheet Excel workbook — summary, amortization schedule, journal entries, maturity analysis, and disclosure notes.' },
          ].map((step, i) => (
            <div key={i} className="bg-navy2 p-12 relative hover:bg-card-hover transition-colors">
              <div className="font-heading text-[72px] font-extrabold text-white/4 leading-none absolute top-6 right-7">{step.number}</div>
              <div
                className={`w-[52px] h-[52px] rounded-[14px] flex items-center justify-center text-2xl mb-6 ${
                  step.iconBg === 'blue' ? 'bg-indigo/15' : step.iconBg === 'green' ? 'bg-emerald/12' : 'bg-amber/12'
                }`}
              >
                {step.icon}
              </div>
              <h3 className="font-heading text-xl font-bold text-white mb-3">{step.title}</h3>
              <p className="text-[15px] text-text-muted leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-[1200px] mx-auto px-[5%] py-20">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-light uppercase tracking-wide mb-4">
          <div className="w-5 h-px bg-indigo-light"></div>
          Modules
        </div>
        <h2 className="font-heading text-[clamp(32px,4vw,48px)] font-extrabold leading-[1.15] tracking-[-1.5px] text-white mb-4">
          Everything your<br />finance team needs
        </h2>
        <p className="text-[17px] text-text-muted max-w-[520px] leading-relaxed mb-0">
          Four AI-powered modules covering the full spectrum of IFRS compliance and financial reporting.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mt-[60px]">
          {[
            { icon: '🏗️', tag: 'Production Ready', title: 'IFRS 16 — Lease Automator', desc: 'ROU asset, lease liability, amortization schedule, journal entries and disclosure notes — generated from your PDF in seconds. What takes 4 days takes 4 minutes.', modules: ['ROU Asset', 'Lease Liability', 'Journal Entries', 'Disclosure Notes'] },
            { icon: '📈', tag: 'Production Ready', title: 'IFRS 9 — ECL Calculator', desc: 'Stage 1/2/3 classification, PD×LGD×EAD calculation, SICR detection, provisioning entries and portfolio reports — fully automated for your loan book.', modules: ['Staging Engine', 'ECL Calculation', 'SICR Detection', 'Audit Trail'] },
            { icon: '💰', tag: 'Production Ready', title: 'IFRS 15 — Revenue Recognition', desc: '5-step revenue model, performance obligation identification, transaction price allocation using SSP method, and recognition schedules — all from your contract.', modules: ['5-Step Model', 'SSP Allocation', 'Revenue Schedule'] },
            { icon: '💬', tag: 'AI-Powered', title: 'Portfolio AI Q&A', desc: 'Ask your entire lease portfolio anything in plain English. "What is my total liability in Delhi offices?" — answered instantly from your data, securely isolated per company.', modules: ['Natural Language', 'RAG Engine', 'Data Isolation'] },
          ].map((feature, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-2xl p-9 hover:border-indigo/30 hover:bg-card-hover hover:-translate-y-0.5 transition-all cursor-pointer relative overflow-hidden group"
            >
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[22px] mb-5 bg-indigo/12 border border-indigo/20">{feature.icon}</div>
              <div className="inline-block text-[11px] font-semibold text-emerald bg-emerald/10 border border-emerald/20 px-2.5 py-0.5 rounded-full uppercase tracking-wide mb-3.5">
                {feature.tag}
              </div>
              <h3 className="font-heading text-xl font-bold text-white mb-2.5">{feature.title}</h3>
              <p className="text-sm text-text-muted leading-relaxed mb-5">{feature.desc}</p>
              <div className="flex flex-wrap gap-2">
                {feature.modules.map((module, j) => (
                  <span key={j} className="text-xs text-indigo-light bg-indigo/10 px-3 py-1 rounded-full border border-indigo/15">
                    {module}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-[1200px] mx-auto px-[5%] py-20">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-light uppercase tracking-wide mb-4">
          <div className="w-5 h-px bg-indigo-light"></div>
          Pricing
        </div>
        <h2 className="font-heading text-[clamp(32px,4vw,48px)] font-extrabold leading-[1.15] tracking-[-1.5px] text-white mb-4">
          Simple, transparent<br />pricing
        </h2>
        <p className="text-[17px] text-text-muted max-w-[520px] leading-relaxed mb-0">
          Less than one hour of your auditor's billing rate. Saves your team 3–4 days every month.
        </p>

        <div className="grid md:grid-cols-2 gap-6 max-w-[800px] mt-[60px]">
          {[
            { plan: 'Starter', price: '₹15,000', period: '/month', sub: 'Up to 25 leases per month', featured: false, features: ['IFRS 16, 15 & 9 modules', 'PDF contract extraction', '5-sheet Excel export', 'AI Portfolio Q&A (50 queries)', 'Email support', 'Audit-ready disclosure notes'], button: 'Get Started', buttonVariant: 'ghost' },
            { plan: 'Enterprise', price: '₹50,000', period: '/month', sub: 'Unlimited leases + API access', featured: true, features: ['Everything in Starter', 'Unlimited leases & calculations', 'REST API access', 'ERP integration support', 'Unlimited AI Q&A', 'Dedicated onboarding', 'Priority support & SLA'], button: 'Contact Sales', buttonVariant: 'primary' },
          ].map((pricing, i) => (
            <div
              key={i}
              className={`bg-card border rounded-[20px] p-10 transition-all relative overflow-hidden ${
                pricing.featured ? 'border-indigo/40 bg-indigo/5' : 'border-border'
              }`}
            >
              {pricing.featured && (
                <div className="absolute top-5 -right-8 bg-indigo text-white text-[10px] font-bold tracking-wide px-12 py-1 rotate-45">
                  MOST POPULAR
                </div>
              )}
              <div className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-2">{pricing.plan}</div>
              <div className="font-heading text-[42px] font-extrabold leading-none text-white mb-1">
                {pricing.price}
                <span className="text-lg font-normal text-text-muted">{pricing.period}</span>
              </div>
              <div className="text-[13px] text-text-muted mb-7">{pricing.sub}</div>
              <div className="h-px bg-border mb-6"></div>
              <ul className="list-none mb-8 space-y-2">
                {pricing.features.map((feature, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm text-text-muted">
                    <CheckCircle className="w-4 h-4 text-emerald flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {pricing.buttonVariant === 'primary' ? (
                <button className="w-full py-3.5 bg-indigo text-white rounded-[10px] text-[15px] font-semibold hover:bg-indigo-light transition-all shadow-[0_0_30px_rgba(79,110,247,0.3)]">
                  {pricing.button}
                </button>
              ) : (
                <button className="w-full py-3.5 bg-transparent text-text border border-border rounded-[10px] text-[15px] font-medium hover:border-white/20 hover:bg-card-hover transition-all">
                  {pricing.button}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-[1200px] mx-auto px-[5%] pb-[100px]">
        <div className="bg-gradient-to-br from-indigo/15 to-emerald/8 border border-indigo/25 rounded-3xl p-[72px] text-center relative overflow-hidden">
          <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(79,110,247,0.2),transparent_70%)] pointer-events-none"></div>
          <h2 className="font-heading text-[42px] font-extrabold tracking-[-1.5px] text-white mb-4 relative z-10">
            Ready to automate your<br />IFRS compliance?
          </h2>
          <p className="text-[17px] text-text-muted mb-9 relative z-10">
            Join finance teams saving 3–4 days every month. Get a live demo in 24 hours.
          </p>
          <div className="flex justify-center gap-3.5 relative z-10">
            <Link href="/login" className="px-8 py-3.5 bg-indigo text-white rounded-[10px] text-[15px] font-semibold hover:-translate-y-0.5 transition-all shadow-[0_0_40px_rgba(79,110,247,0.4)] hover:shadow-[0_8px_50px_rgba(79,110,247,0.6)]">
              Request Demo →
            </Link>
            <Link href="#" className="px-8 py-3.5 bg-transparent text-text border border-border rounded-[10px] text-[15px] font-medium hover:border-white/20 hover:bg-card-hover transition-all">
              Talk to Sales
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border px-[5%] py-10 max-w-[1200px] mx-auto flex items-center justify-between">
        <div className="text-[13px] text-text-muted">© 2026 IFRS.ai — Built for CFOs. Powered by AI.</div>
        <div className="flex gap-6">
          <Link href="#" className="text-[13px] text-text-muted hover:text-text transition-colors">Privacy</Link>
          <Link href="#" className="text-[13px] text-text-muted hover:text-text transition-colors">Terms</Link>
          <Link href="#" className="text-[13px] text-text-muted hover:text-text transition-colors">Documentation</Link>
          <Link href="#" className="text-[13px] text-text-muted hover:text-text transition-colors">Contact</Link>
        </div>
      </footer>
    </div>
  );
}
