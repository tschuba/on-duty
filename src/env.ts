import { logger } from "./lib/logger.js";
import { DEFAULT_ACTIVE_AGE_LIMIT } from "./lib/status.js";
const REQUIRED = [
  "DATABASE_URL",
  "ORG_NAME",
  "ADMIN_PASSWORD",
  "BETTER_AUTH_SECRET",
  "OIDC_PROVIDER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_APP_URL",
] as const;


export function validateEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }

  const minLen = Number(process.env.ADMIN_PASSWORD_MIN_LENGTH ?? "12");
  if ((process.env.ADMIN_PASSWORD ?? "").length < minLen) {
    logger.warn({ minLen }, "ADMIN_PASSWORD is shorter than minimum length (set ADMIN_PASSWORD_MIN_LENGTH to override)");
  }

  const childrenLimit = Number(process.env.CHILDREN_AGE_LIMIT ?? "12");
  const youthLimit = Number(process.env.YOUTH_AGE_LIMIT ?? "18");
  if (childrenLimit >= youthLimit) {
    logger.fatal({ childrenLimit, youthLimit }, "CHILDREN_AGE_LIMIT must be less than YOUTH_AGE_LIMIT");
    process.exit(1);
  }

  const tz = process.env.APP_TIMEZONE ?? "Europe/Berlin";
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
  } catch {
    logger.fatal({ tz }, "APP_TIMEZONE is not a valid IANA time zone name");
    process.exit(1);
  }

}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  ORG_NAME: process.env.ORG_NAME!,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
  OIDC_PROVIDER: process.env.OIDC_PROVIDER!,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID!,
  OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET!,
  OIDC_APP_URL: process.env.OIDC_APP_URL!,
  OIDC_ACCOUNT_URL: process.env.OIDC_ACCOUNT_URL,
  ADMIN_PASSWORD_MIN_LENGTH: Number(process.env.ADMIN_PASSWORD_MIN_LENGTH ?? "12"),
  SESSION_LIFETIME: process.env.SESSION_LIFETIME ?? "7d",
  CHILDREN_AGE_LIMIT: Number(process.env.CHILDREN_AGE_LIMIT ?? "12"),
  YOUTH_AGE_LIMIT: Number(process.env.YOUTH_AGE_LIMIT ?? "18"),
  ACTIVE_AGE_LIMIT: Number(process.env.ACTIVE_AGE_LIMIT ?? String(DEFAULT_ACTIVE_AGE_LIMIT)),
  // Ehrungstermin (MM-DD): Datum, an dem Jubiläen geehrt werden
  ANNIVERSARY_CUTOFF: process.env.ANNIVERSARY_CUTOFF ?? "01-06",
  // Feste Zone der Wehr für Termine (IANA-Name), siehe lib/datetime.ts
  APP_TIMEZONE: process.env.APP_TIMEZONE ?? "Europe/Berlin",
  EVENTS_PUBLIC_INDEXING: process.env.EVENTS_PUBLIC_INDEXING === "true",
  // Pfad zur status.json des Backup-Containers; leer = Überwachung aus
  BACKUP_STATUS_FILE: process.env.BACKUP_STATUS_FILE,
  BACKUP_STATUS_MAX_AGE_HOURS: Number(process.env.BACKUP_STATUS_MAX_AGE_HOURS ?? "26"),
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  ZITADEL_WEBHOOK_SECRET_FILE: process.env.ZITADEL_WEBHOOK_SECRET_FILE,
  // Sentry-compatible error reporting (opt-in); read in lib/sentry.ts
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_DSN_FILE: process.env.SENTRY_DSN_FILE,
  // Link shown in /admin/config (opt-in); not read by lib/sentry.ts, purely informational.
  ERROR_TRACKER_URL: process.env.ERROR_TRACKER_URL,
};

export const ENV_META: { key: keyof typeof env; value: string | number | undefined }[] = [
  { key: "ORG_NAME",                  value: env.ORG_NAME },
  { key: "CHILDREN_AGE_LIMIT",        value: env.CHILDREN_AGE_LIMIT },
  { key: "YOUTH_AGE_LIMIT",           value: env.YOUTH_AGE_LIMIT },
  { key: "ACTIVE_AGE_LIMIT",          value: env.ACTIVE_AGE_LIMIT },
  { key: "ANNIVERSARY_CUTOFF",        value: env.ANNIVERSARY_CUTOFF },
  { key: "APP_TIMEZONE",              value: env.APP_TIMEZONE },
  { key: "EVENTS_PUBLIC_INDEXING",    value: String(env.EVENTS_PUBLIC_INDEXING) },
  { key: "SESSION_LIFETIME",          value: env.SESSION_LIFETIME },
  { key: "ADMIN_PASSWORD_MIN_LENGTH", value: env.ADMIN_PASSWORD_MIN_LENGTH },
  { key: "BACKUP_STATUS_FILE",       value: env.BACKUP_STATUS_FILE },
  { key: "BACKUP_STATUS_MAX_AGE_HOURS", value: env.BACKUP_STATUS_MAX_AGE_HOURS },
  { key: "SMTP_HOST",                 value: env.SMTP_HOST },
  { key: "SMTP_FROM",                 value: env.SMTP_FROM },
  { key: "ERROR_TRACKER_URL",         value: env.ERROR_TRACKER_URL },
];
