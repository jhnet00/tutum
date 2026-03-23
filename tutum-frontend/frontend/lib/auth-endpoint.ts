const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export function getAuthApiBase(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_URL || "";
  }

  return LOCAL_HOSTS.has(window.location.hostname) ? "/api/proxy" : "";
}

export function buildAuthUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getAuthApiBase()}${normalizedPath}`;
}
