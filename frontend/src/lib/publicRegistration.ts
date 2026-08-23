/**
 * Display-only counterpart of Django's PUBLIC_REGISTRATION_ENABLED switch.
 * The backend remains the authority and rejects registration even if a stale
 * frontend bundle were built with this value enabled.
 */
export const PUBLIC_REGISTRATION_ENABLED =
  process.env.NEXT_PUBLIC_REGISTRATION_ENABLED === "true";
