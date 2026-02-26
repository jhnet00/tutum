import { NextRequest } from "next/server";

function getBackendBaseUrl(): string | null {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    null
  );
}

async function handler(request: NextRequest, path: string[]) {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    console.error("[Proxy] ERROR: API base URL is not configured");
    return new Response(JSON.stringify({ detail: "API base URL is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const targetUrl = new URL(`${baseUrl.replace(/\/$/, "")}/${path.join("/")}`);
  targetUrl.search = request.nextUrl.search;

  console.log(`[Proxy] ${request.method} ${targetUrl.toString()}`);

  const headers = new Headers();
  const passthroughHeaders = ["authorization", "content-type", "x-csrf-token", "cookie"];
  for (const key of passthroughHeaders) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }

  try {
    const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
    const body = hasBody ? await request.arrayBuffer() : undefined;

    const upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });

    // Handle redirects: rewrite internal backend URLs to go through proxy
    if ([301, 302, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (location) {
        const normalizedBase = baseUrl.replace(/\/$/, "");
        if (location.startsWith(normalizedBase)) {
          const internalPath = location.slice(normalizedBase.length);
          const rewritten = `/api/proxy${internalPath}`;
          return new Response(null, {
            status: upstream.status,
            headers: { location: rewritten },
          });
        }
        return new Response(null, {
          status: upstream.status,
          headers: { location },
        });
      }
    }

    const responseHeaders = new Headers();
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() !== "set-cookie") {
        responseHeaders.set(key, value);
      }
    }
    // FastAPI는 charset 미명시 → 브라우저가 Latin-1 해석 → 한글 깨짐 방지
    const ct = responseHeaders.get("content-type");
    if (ct && ct.includes("application/json") && !ct.includes("charset")) {
      responseHeaders.set("content-type", ct + "; charset=utf-8");
    }
    const setCookies = (upstream.headers as any).getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      responseHeaders.append("set-cookie", cookie);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[Proxy] FETCH ERROR: ${request.method} ${targetUrl.toString()}`, error);
    return new Response(JSON.stringify({ 
      detail: "Backend connection failed", 
      error: error.message 
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: { path: string[] } }) {
  return handler(request, context.params.path);
}
export async function POST(request: NextRequest, context: { params: { path: string[] } }) {
  return handler(request, context.params.path);
}
export async function PUT(request: NextRequest, context: { params: { path: string[] } }) {
  return handler(request, context.params.path);
}
export async function PATCH(request: NextRequest, context: { params: { path: string[] } }) {
  return handler(request, context.params.path);
}
export async function DELETE(request: NextRequest, context: { params: { path: string[] } }) {
  return handler(request, context.params.path);
}
export async function OPTIONS(request: NextRequest, context: { params: { path: string[] } }) {
  return handler(request, context.params.path);
}

