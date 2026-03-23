import { NextRequest } from "next/server";
import { handleLocalMockAuth } from "../mock-auth";

type ProxyErrorPayload = {
  request_id: string;
  code: string;
  message: string;
  detail: string | Record<string, unknown>;
  upstream_status?: number;
  upstream_path: string;
};

function getBackendBaseUrl(): string | null {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    null
  );
}

function buildErrorResponse(
  request: NextRequest,
  path: string[],
  code: string,
  message: string,
  detail: string | Record<string, unknown>,
  status = 500,
  upstreamPath = "",
): Response {
  const payload: ProxyErrorPayload = {
    request_id: request.headers.get("x-request-id") || crypto.randomUUID(),
    code,
    message,
    detail,
    upstream_status: status,
    upstream_path: upstreamPath,
  };

  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-proxy-request-id": payload.request_id,
    },
  });
}

async function handler(request: NextRequest, path: string[]) {
  const mockResponse = await handleLocalMockAuth(request, path);
  if (mockResponse) {
    return mockResponse;
  }

  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    console.error("[Proxy] ERROR: API base URL is not configured");
    return buildErrorResponse(
      request,
      path,
      "MISSING_API_BASE_URL",
      "API base URL is not configured",
      "Set BACKEND_INTERNAL_URL, API_BASE_URL, or NEXT_PUBLIC_API_URL in frontend env",
      500,
      `/${path.join("/")}`,
    );
  }

  const isOcrPath = path[0] === "import" && path[1] === "ocr";

  let targetUrl: URL;
  if (path[0] === "import") {
    const ocrBaseUrl = process.env.OCR_SERVICE_URL || "http://ocr.tutum-app.svc.cluster.local:8002";
    targetUrl = new URL(`${ocrBaseUrl.replace(/\/$/, "")}/${path.join("/")}`);
  } else {
    targetUrl = new URL(`${baseUrl.replace(/\/$/, "")}/${path.join("/")}`);
  }
  targetUrl.search = request.nextUrl.search;

  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const normalizedPath = targetUrl.pathname;

  console.log(`[Proxy] ${request.method} ${request.nextUrl.pathname} -> ${targetUrl.toString()}`);

  const headers = new Headers();
  const passthroughHeaders = ["authorization", "content-type", "x-csrf-token", "cookie"];
  for (const key of passthroughHeaders) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("x-request-id", requestId);
  headers.set("x-forwarded-host", request.headers.get("host") || "");

  try {
    const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
    const body = hasBody ? await request.arrayBuffer() : undefined;

    const upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      ...(hasBody ? { body } : {}),
      redirect: "manual",
      cache: "no-store",
    });

    if ([301, 302, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (location) {
        const redirectHeaders = new Headers();
        const setCookiesOnRedirect = (upstream.headers as any).getSetCookie?.() ?? [];
        for (const cookie of setCookiesOnRedirect) {
          redirectHeaders.append("set-cookie", cookie);
        }
        const normalizedBase = baseUrl.replace(/\/$/, "");
        if (location.startsWith(normalizedBase)) {
          const internalPath = location.slice(normalizedBase.length);
          redirectHeaders.set("location", `/api/proxy${internalPath}`);
        } else {
          redirectHeaders.set("location", location);
        }
        return new Response(null, { status: upstream.status, headers: redirectHeaders });
      }
    }

    const responseHeaders = new Headers();
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() !== "set-cookie") {
        responseHeaders.set(key, value);
      }
    }
    responseHeaders.set("x-proxy-request-id", requestId);

    if (!upstream.ok) {
      const rawText = await upstream.text();
      let parsed: string | Record<string, unknown> = rawText || "empty response";
      if (rawText && rawText.trim()) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = rawText;
        }
      }

      const code = isOcrPath
        ? (upstream.status === 403 ? "OCR_PATH_BLOCKED" : "OCR_UPSTREAM_ERROR")
        : "UPSTREAM_ERROR";
      const message =
        isOcrPath && upstream.status === 403
          ? "OCR request was blocked (WAF or proxy policy)."
          : "Upstream service returned an error response.";

      return buildErrorResponse(
        request,
        path,
        code,
        message,
        parsed,
        upstream.status,
        normalizedPath,
      );
    }

    const ct = upstream.headers.get("content-type");
    if (ct && ct.includes("application/json") && !ct.includes("charset")) {
      responseHeaders.set("content-type", `${ct}; charset=utf-8`);
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
    return buildErrorResponse(
      request,
      path,
      isOcrPath ? "OCR_UPSTREAM_UNREACHABLE" : "UPSTREAM_UNREACHABLE",
      "Upstream service is unreachable",
      { message: error?.message || "Unknown fetch error", name: error?.name },
      502,
      normalizedPath,
    );
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