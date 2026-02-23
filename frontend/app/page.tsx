import Link from 'next/link';
import { Button } from '@/components/Button';
import {
  Clock,
  CheckCircle,
  Layers,
  Target,
  FileText,
  TrendingUp,
  DollarSign,
  MessageCircle,
  Upload,
  Cpu,
  Download,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 sticky top-0 bg-white z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-2xl font-bold text-primary">
                IFRS<span className="text-accent">.ai</span>
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="primary" size="sm">
                  Request Demo
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 bg-gradient-to-br from-primary via-primary to-accent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-white">
              <div className="inline-block px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium mb-6">
                Trusted by Finance Teams
              </div>
              <h1 className="text-5xl font-bold mb-6 leading-tight">
                IFRS Compliance,<br />
                Automated by AI
          </h1>
              <p className="text-xl text-white/90 mb-8 leading-relaxed">
                Stop spending 4 days on lease calculations. Upload your contract, get audit-ready reports in 4 minutes.
              </p>
              <div className="flex gap-4">
                <Link href="/login">
                  <Button variant="secondary" size="lg">
                    Request Demo
                  </Button>
                </Link>
                <Button variant="ghost" size="lg">
                  See How It Works
                </Button>
              </div>
            </div>
            <div className="relative">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
                <div className="aspect-video bg-white/5 rounded-lg flex items-center justify-center">
                  <p className="text-white/50 text-sm">Dashboard Preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics Bar */}
      <section className="py-12 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-3xl font-bold text-accent mb-2">4 Minutes</div>
              <div className="text-sm text-gray-600">Avg calculation time</div>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-3xl font-bold text-success mb-2">100%</div>
              <div className="text-sm text-gray-600">IFRS compliant output</div>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-3xl font-bold text-accent mb-2">3 Standards</div>
              <div className="text-sm text-gray-600">IFRS 16, 15, 9</div>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-3xl font-bold text-success mb-2">0 Errors</div>
              <div className="text-sm text-gray-600">vs manual Excel</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-primary mb-4">How It Works</h2>
            <p className="text-xl text-gray-600">Three simple steps to IFRS compliance</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-accent/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-bold mb-3">Step 1 — Upload</h3>
              <p className="text-gray-600">Upload your lease contract (PDF, DOCX, or manual entry)</p>
            </div>
            <div className="text-center">
              <div className="bg-accent/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <Cpu className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-bold mb-3">Step 2 — AI Extracts</h3>
              <p className="text-gray-600">AI extracts lease terms and calculates IFRS metrics automatically</p>
            </div>
            <div className="text-center">
              <div className="bg-success/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <Download className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-xl font-bold mb-3">Step 3 — Download</h3>
              <p className="text-gray-600">Download audit-ready Excel report with journal entries</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-primary mb-4">Complete IFRS Automation Suite</h2>
            <p className="text-xl text-gray-600">All standards, one platform</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <FileText className="w-12 h-12 text-accent mb-4" />
              <h3 className="text-2xl font-bold mb-3">IFRS 16 Lease Automator</h3>
              <p className="text-gray-600 mb-4">
                ROU asset, lease liability, amortization schedule, journal entries — generated in seconds
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Present value calculations</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Effective interest method</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Auto journal entries</span>
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <TrendingUp className="w-12 h-12 text-accent mb-4" />
              <h3 className="text-2xl font-bold mb-3">IFRS 9 ECL Calculator</h3>
              <p className="text-gray-600 mb-4">
                Stage 1/2/3 classification, PD×LGD×EAD, provisioning entries — automated
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Automatic staging (SICR detection)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>12-month and lifetime ECL</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Portfolio analysis</span>
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <DollarSign className="w-12 h-12 text-accent mb-4" />
              <h3 className="text-2xl font-bold mb-3">IFRS 15 Revenue Recognition</h3>
              <p className="text-gray-600 mb-4">
                5-step model, performance obligations, SSP allocation — done by AI
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Performance obligation identification</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Transaction price allocation</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Revenue schedules</span>
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <MessageCircle className="w-12 h-12 text-accent mb-4" />
              <h3 className="text-2xl font-bold mb-3">AI Portfolio Q&A</h3>
              <p className="text-gray-600 mb-4">
                Ask your lease portfolio anything. "What is my total liability in Mumbai?" — answered instantly
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Natural language queries</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Multi-document analysis</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Instant insights</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-primary mb-4">Simple, Transparent Pricing</h2>
            <p className="text-xl text-gray-600">Choose the plan that fits your needs</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl p-8 shadow-lg border-2 border-gray-200">
              <h3 className="text-2xl font-bold mb-2">Starter</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-primary">₹15,000</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                  <span>Up to 25 leases</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                  <span>IFRS 16, 15, 9 modules</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                  <span>Excel export</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                  <span>AI Q&A (50 queries/month)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                  <span>Email support</span>
                </li>
              </ul>
              <Link href="/login" className="block">
                <Button variant="ghost" size="lg" className="w-full">
                  Get Started
                </Button>
              </Link>
            </div>

            <div className="bg-gradient-to-br from-accent to-accent/80 rounded-2xl p-8 shadow-xl text-white relative overflow-hidden">
              <div className="absolute top-4 right-4 bg-white text-accent px-3 py-1 rounded-full text-xs font-bold">
                POPULAR
              </div>
              <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">₹50,000</span>
                <span className="text-white/80">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Unlimited leases</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>All modules + API access</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>ERP integration support</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Unlimited AI Q&A</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Dedicated support</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Custom onboarding</span>
                </li>
              </ul>
              <Link href="/login" className="block">
                <Button variant="secondary" size="lg" className="w-full">
                  Contact Sales
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-12 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-600 mb-8">Trusted by leading finance teams</p>
          <div className="flex justify-center items-center gap-12 flex-wrap opacity-50">
            <div className="bg-gray-200 h-12 w-32 rounded"></div>
            <div className="bg-gray-200 h-12 w-32 rounded"></div>
            <div className="bg-gray-200 h-12 w-32 rounded"></div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-primary text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-white/80">
                <li>IFRS 16</li>
                <li>IFRS 15</li>
                <li>IFRS 9</li>
                <li>Pricing</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-white/80">
                <li>About</li>
                <li>Careers</li>
                <li>Blog</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-white/80">
                <li>Documentation</li>
                <li>API Reference</li>
                <li>Support</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-white/80">
                <li>support@ifrs.ai</li>
                <li>+91 XXXX XXXXXX</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/20 pt-8 text-center text-sm text-white/80">
            <p>Built for CFOs. Powered by AI.</p>
            <p className="mt-2">© 2026 IFRS.ai. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
