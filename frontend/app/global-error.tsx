'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 24, fontFamily: 'system-ui, sans-serif', background: '#f5f6fa' }}>
        <h1 style={{ fontSize: 20, color: '#1e293b' }}>Application error</h1>
        <p style={{ color: '#475569', fontSize: 14 }}>IFRS.ai failed to render. Check the message below.</p>
        <pre
          style={{
            marginTop: 16,
            padding: 16,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            color: '#b91c1c',
            fontSize: 12,
            overflow: 'auto',
            maxHeight: 200,
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          style={{
            marginTop: 16,
            padding: '10px 16px',
            background: '#f97316',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => reset()}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
