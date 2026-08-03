export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "";

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedBase =
    API_BASE_URL.endsWith("/api") && normalizedPath.startsWith("/api/")
      ? API_BASE_URL.slice(0, -"/api".length)
      : API_BASE_URL;

  return `${normalizedBase}${normalizedPath}`;
}
