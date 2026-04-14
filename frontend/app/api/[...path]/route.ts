import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-base";
import { getBackendProxyFailureDetail } from "@/lib/service-messages";

export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);

function forwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    out.append(key, value);
  });
  return out;
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  const base = getBackendBaseUrl();
  const url = new URL(req.url);
  const suffix = pathSegments.length ? pathSegments.join("/") : "";
  const targetPath = suffix ? `api/${suffix}` : "api";
  const target = `${base}/${targetPath}${url.search}`;

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: forwardHeaders(req.headers),
  };

  if (hasBody && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        detail: getBackendProxyFailureDetail(base),
        proxy_error: message,
      },
      { status: 502 }
    );
  }

  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

type RouteCtx = { params: Promise<{ path?: string[] }> };

async function handle(req: NextRequest, ctx: RouteCtx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
