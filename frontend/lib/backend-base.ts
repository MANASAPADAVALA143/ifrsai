import fs from "fs";
import path from "path";

/**
 * Python API base URL for the server-side proxy. Resolved per request so
 * ../api_dev_port.txt updates apply without restarting `npm run dev`.
 */
export function getBackendBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const fromEnvPort = process.env.BACKEND_PORT?.trim();
  if (fromEnvPort && /^\d+$/.test(fromEnvPort)) {
    return `http://127.0.0.1:${fromEnvPort}`;
  }

  const portFile = path.join(process.cwd(), "..", "api_dev_port.txt");
  try {
    if (fs.existsSync(portFile)) {
      const port = fs.readFileSync(portFile, "utf8").trim();
      if (/^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
    }
  } catch {
    /* ignore */
  }

  return "http://127.0.0.1:9000";
}
