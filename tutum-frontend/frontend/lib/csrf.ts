export function getCsrfTokenFromCookie(): string | null {
    if (typeof document === "undefined") return null;

    const cookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("csrf_token="));

    if (!cookie) return null;
    const value = cookie.split("=")[1];
    return value ? decodeURIComponent(value) : null;
}

export function withCsrfHeader(headers: HeadersInit = {}): HeadersInit {
    const csrf = getCsrfTokenFromCookie();
    if (!csrf) return headers;
    return {
        ...headers,
        "X-CSRF-Token": csrf,
    };
}
