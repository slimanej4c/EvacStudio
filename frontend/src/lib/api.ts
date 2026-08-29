export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "";

function effectiveApiBaseUrl(): string {
  if (typeof window === "undefined" || !API_BASE_URL) return API_BASE_URL;
  try {
    const configured = new URL(API_BASE_URL);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    // Cookies cannot cross localhost <-> 127.0.0.1. In development, keep the
    // configured port but use the exact hostname that opened Next.js.
    if (
      localHosts.has(configured.hostname)
      && localHosts.has(window.location.hostname)
    ) {
      configured.hostname = window.location.hostname;
      return configured.toString().replace(/\/+$/, "");
    }
  } catch {
    // Relative production base paths do not need URL rewriting.
  }
  return API_BASE_URL;
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiBaseUrl = effectiveApiBaseUrl();
  const normalizedBase =
    apiBaseUrl.endsWith("/api") && normalizedPath.startsWith("/api/")
      ? apiBaseUrl.slice(0, -"/api".length)
      : apiBaseUrl;

  return `${normalizedBase}${normalizedPath}`;
}

export function isProtectedMediaUrl(source: string): boolean {
  return source.includes("/api/media/");
}

export function imageCrossOrigin(source: string): "use-credentials" | "anonymous" {
  return isProtectedMediaUrl(source) ? "use-credentials" : "anonymous";
}
