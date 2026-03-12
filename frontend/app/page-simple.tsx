// Simplified landing page to test
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div style={{ padding: '50px', fontFamily: 'Arial', background: '#080F1E', color: 'white', minHeight: '100vh' }}>
      <h1>IFRS.ai - Landing Page</h1>
      <p>If you see this, the server is working!</p>
      <Link href="/test" style={{ color: '#4F6EF7' }}>Go to Test Page</Link>
    </div>
  );
}
