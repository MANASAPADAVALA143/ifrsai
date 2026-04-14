import Link from 'next/link';
import { LandingPageClient } from './landing-page-client';

/**
 * Home: this file is a Server Component. The strip below is real HTML from Next.js — it does
 * NOT call Python. A blank page with nothing here means the browser never got Next.js output
 * (wrong URL, dev server down, or extension blocking), not a “backend render” issue.
 */
export default function HomePage() {
  return (
    <>
      <div
        className="px-4 py-2.5 text-xs leading-relaxed border-b border-white/10 text-white/95"
        style={{ background: '#0a1628' }}
      >
        <strong className="text-white">Local dev</strong>
        <span className="text-white/80">
          {' '}
          — This bar is rendered by Next.js without the Python API. IFRS features (upload, calculate)
          need{' '}
          <span className="text-emerald font-medium">both</span> windows from START_LOCALHOST.bat.
        </span>
        <span className="text-white/60"> · </span>
        <Link href="/test" className="text-indigo-light underline font-medium">
          /test (no React bells)
        </Link>
        <span className="text-white/60"> · </span>
        <Link href="/login" className="text-indigo-light underline font-medium">
          Sign in
        </Link>
      </div>
      <LandingPageClient />
    </>
  );
}
