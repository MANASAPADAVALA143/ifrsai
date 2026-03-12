import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resolve lockfile warning when multiple lockfiles exist (e.g. parent folder)
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:9000/api/:path*',
      },
    ];
  },
  // Recharts is handled via dynamic imports in components/Charts.tsx
  // No need for serverExternalPackages or transpilePackages
};

export default nextConfig;
