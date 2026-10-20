// Sentinel values protecting the built-in local-admin account (seeded in
// src/db/seed.ts) from deletion, permission removal, or login confusion.
export const LOCAL_ADMIN_ACCOUNT_ID = "admin";
export const LOCAL_ADMIN_EMAIL = "admin@localhost.invalid";

export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  TOO_MANY_REQUESTS: 429,
} as const;

export const SEARCH_DEBOUNCE_MS = 300;

// Maximale Länge der Notiz einer Funktionszuweisung (inkl. Umbrüche, je 1 Zeichen).
export const ASSIGNMENT_NOTE_MAX_LENGTH = 200;
