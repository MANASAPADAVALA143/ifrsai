import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * API calls use relative `/api/*`. The App Router handler at `app/api/[...path]/route.ts`
 * proxies to Python using `lib/backend-base.ts` (reads `../api_dev_port.txt` per request).
 *
 * Pin Turbopack root to this app folder. If a package-lock.json exists higher in the tree
 * (e.g. under your user profile), Next can otherwise pick the wrong workspace root and serve broken/empty JS.
 */
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  /** Keep tracing rooted here even if a lockfile exists under the user profile (see turbopack comment). */
  outputFileTracingRoot: appDir,
  turbopack: {
    root: appDir,
  },
};

export default nextConfig;
