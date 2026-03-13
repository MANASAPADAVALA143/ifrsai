import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resolve lockfile warning when multiple lockfiles exist (e.g. parent folder)
  turbopack: { root: process.cwd() },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
  // Recharts is handled via dynamic imports in components/Charts.tsx
  // No need for serverExternalPackages or transpilePackages
};

export default nextConfig;
