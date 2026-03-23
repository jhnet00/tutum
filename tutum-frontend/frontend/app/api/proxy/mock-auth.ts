import { NextRequest, NextResponse } from "next/server";

type MockUser = {
  id: string;
  email: string;
  nickname: string;
  marketing_opt_in: boolean;
  login_type: string;
  profile_image?: string;
  created_at: string;
};

type MockSession = {
  user: MockUser;
  password: string;
  refreshToken: string;
  csrfToken: string;
};

const AUTH_COOKIE = "auth_token";
const REFRESH_COOKIE = "refresh_token";
const CSRF_COOKIE = "csrf_token";
const SESSION_COOKIE = "tutum_mock_session";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function mockEmail(): string {
  return process.env.LOCAL_MOCK_AUTH_EMAIL || "local@tutum.dev";
}

function mockPassword(): string {
  return process.env.LOCAL_MOCK_AUTH_PASSWORD || "Tutum123!";
}

function mockNickname(): string {
  return process.env.LOCAL_MOCK_AUTH_NICKNAME || "Local Tester";
}

function buildMockUser(loginType: string): MockUser {
  const suffix = loginType === "email" ? "" : `+${loginType}`;
  return {
    id: "mock-user",
    email: mockEmail().replace("@", `${suffix}@`),
    nickname: loginType === "email" ? mockNickname() : `${loginType.toUpperCase()} Tester`,
    marketing_opt_in: true,
    login_type: loginType === "email" ? "local-mock" : `${loginType}-mock`,
    created_at: new Date().toISOString(),
  };
}

function encodeSession(session: MockSession): string {
  return Buffer.from(JSON.stringify(session), "utf-8").toString("base64url");
}

function decodeSession(raw: string | undefined): MockSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as MockSession;
  } catch {
    return null;
  }
}

function isLocalMockEnabled(request: NextRequest): boolean {
  if (process.env.LOCAL_MOCK_AUTH === "false") return false;
  if (process.env.LOCAL_MOCK_AUTH === "true") return true;
  return process.env.NODE_ENV !== "production" && LOCAL_HOSTS.has(request.nextUrl.hostname);
}

function normalizeAuthPath(path: string[]): string[] {
  if (path[0] === "api") return path.slice(1);
  return path;
}

function isMockAuthPath(path: string[]): boolean {
  const normalized = normalizeAuthPath(path);
  return normalized[0] === "v1" && normalized[1] === "auth";
}

function readSession(request: NextRequest): MockSession | null {
  return decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
}

function setAuthCookies(response: NextResponse, accessToken: string, session: MockSession) {
  response.cookies.set(AUTH_COOKIE, accessToken, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 2,
  });
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
  response.cookies.set(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 2,
  });
  response.cookies.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(CSRF_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

function createSession(user: MockUser, password: string): [string, MockSession] {
  const accessToken = `mock-local-${crypto.randomUUID()}`;
  const session: MockSession = {
    user,
    password,
    refreshToken: `mock-refresh-${crypto.randomUUID()}`,
    csrfToken: crypto.randomUUID(),
  };
  return [accessToken, session];
}

function unauthorized(message = "Mock session not found") {
  return NextResponse.json({ detail: message }, { status: 401 });
}

async function handleLogin(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (email !== mockEmail().toLowerCase() || password !== mockPassword()) {
    return NextResponse.json({ detail: "Mock credentials do not match." }, { status: 401 });
  }

  const [accessToken, session] = createSession(buildMockUser("email"), password);
  const response = NextResponse.json({
    access_token: accessToken,
    token_type: "bearer",
    user_id: session.user.id,
    nickname: session.user.nickname,
  });
  setAuthCookies(response, accessToken, session);
  return response;
}

function handleSocialLogin(request: NextRequest, provider: string) {
  const [accessToken, session] = createSession(buildMockUser(provider), mockPassword());
  const response = NextResponse.redirect(new URL("/auth/callback", request.nextUrl.origin), 307);
  setAuthCookies(response, accessToken, session);
  return response;
}

function buildMockProfileImage(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="40" fill="#111827"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="42" font-family="Arial">T</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

function currentAccessToken(request: NextRequest): string {
  return request.cookies.get(AUTH_COOKIE)?.value || `mock-local-${crypto.randomUUID()}`;
}

async function handleUploadProfileImage(session: MockSession) {
  session.user.profile_image = buildMockProfileImage();
  return NextResponse.json({ profile_image: session.user.profile_image });
}

export async function handleLocalMockAuth(request: NextRequest, path: string[]) {
  if (!isLocalMockEnabled(request) || !isMockAuthPath(path)) return null;

  const normalizedPath = normalizeAuthPath(path);
  const method = request.method.toUpperCase();
  const action = normalizedPath[2] || "";
  const subAction = normalizedPath[3] || "";

  if (method === "POST" && action === "login") return handleLogin(request);

  if (method === "GET" && ["google", "kakao", "naver"].includes(action) && subAction === "login") {
    return handleSocialLogin(request, action);
  }

  if (method === "POST" && action === "refresh") {
    const existing = readSession(request);
    if (!existing) return unauthorized("Refresh token not found");

    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken || refreshToken !== existing.refreshToken) {
      return unauthorized("Refresh token not found");
    }

    existing.csrfToken = crypto.randomUUID();
    const accessToken = `mock-local-${crypto.randomUUID()}`;
    const response = NextResponse.json({
      access_token: accessToken,
      token_type: "bearer",
      user_id: existing.user.id,
      nickname: existing.user.nickname,
    });
    setAuthCookies(response, accessToken, existing);
    return response;
  }

  const session = readSession(request);
  if (!session) return unauthorized();

  if (method === "POST" && action === "logout") {
    const response = NextResponse.json({ message: "Successfully logged out" });
    clearAuthCookies(response);
    return response;
  }

  if (method === "GET" && action === "me") {
    return NextResponse.json(session.user);
  }

  if (method === "PUT" && action === "update-profile") {
    const body = (await request.json().catch(() => null)) as { nickname?: string; marketing_opt_in?: boolean } | null;
    if (typeof body?.nickname === "string" && body.nickname.trim()) {
      session.user.nickname = body.nickname.trim();
    }
    if (typeof body?.marketing_opt_in === "boolean") {
      session.user.marketing_opt_in = body.marketing_opt_in;
    }
    const response = NextResponse.json(session.user);
    setAuthCookies(response, currentAccessToken(request), session);
    return response;
  }

  if (method === "PUT" && action === "change-password") {
    const body = (await request.json().catch(() => null)) as { old_password?: string; new_password?: string } | null;
    if (!body?.old_password || !body?.new_password) {
      return NextResponse.json({ detail: "Password is required." }, { status: 400 });
    }
    if (body.old_password !== session.password) {
      return NextResponse.json({ detail: "Current password does not match." }, { status: 400 });
    }
    session.password = body.new_password;
    const response = NextResponse.json({ message: "Password changed." });
    setAuthCookies(response, currentAccessToken(request), session);
    return response;
  }

  if (method === "POST" && action === "upload-profile-image") {
    const response = await handleUploadProfileImage(session);
    setAuthCookies(response, currentAccessToken(request), session);
    return response;
  }

  if (method === "DELETE" && action === "profile-image") {
    session.user.profile_image = undefined;
    const response = NextResponse.json({ message: "Profile image removed." });
    setAuthCookies(response, currentAccessToken(request), session);
    return response;
  }

  if (method === "DELETE" && action === "me") {
    const response = NextResponse.json({ message: "Account deleted." });
    clearAuthCookies(response);
    return response;
  }

  return null;
}
