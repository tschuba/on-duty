const REQUIRED = [
  "DATABASE_URL",
  "ORG_NAME",
  "ADMIN_PASSWORD",
  "OIDC_PROVIDER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_APP_URL",
] as const;

export function validateEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Fehlende Pflicht-Umgebungsvariablen: ${missing.join(", ")}`);
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
  SESSION_LIFETIME: process.env.SESSION_LIFETIME ?? "7d",
  YOUTH_AGE_LIMIT: Number(process.env.YOUTH_AGE_LIMIT ?? "18"),
  ANNIVERSARY_CUTOFF: process.env.ANNIVERSARY_CUTOFF ?? "01-06",
};
