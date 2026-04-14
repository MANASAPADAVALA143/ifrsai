'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-bg-light p-8 text-text-primary">
      <h1 className="text-xl font-bold text-orange-primary mb-2">Something went wrong</h1>
      <p className="text-text-secondary text-sm mb-4 max-w-xl">
        The page hit an error while loading. You can try again or return home.
      </p>
      <pre className="text-xs bg-white border border-border-default rounded-lg p-4 mb-6 overflow-auto max-h-48 text-red-600">
        {error.message}
      </pre>
      <div className="flex gap-3">
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-orange-primary text-white font-medium"
          onClick={() => reset()}
        >
          Try again
        </button>
        <a href="/" className="px-4 py-2 rounded-lg border border-border-default font-medium">
          Home
        </a>
      </div>
    </div>
  );
}
