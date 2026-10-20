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

const S3_VARS = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

export function validateEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const minLen = Number(process.env.ADMIN_PASSWORD_MIN_LENGTH ?? "12");
  if ((process.env.ADMIN_PASSWORD ?? "").length < minLen) {
    console.warn(`⚠️  ADMIN_PASSWORD is shorter than ${minLen} characters (set ADMIN_PASSWORD_MIN_LENGTH to override).`);
  }

  const childrenLimit = Number(process.env.CHILDREN_AGE_LIMIT ?? "12");
  const youthLimit = Number(process.env.YOUTH_AGE_LIMIT ?? "18");
  if (childrenLimit >= youthLimit) {
    console.error(`CHILDREN_AGE_LIMIT (${childrenLimit}) must be less than YOUTH_AGE_LIMIT (${youthLimit}).`);
    process.exit(1);
  }

  const s3Set = S3_VARS.filter((k) => process.env[k]);
  if (s3Set.length > 0 && s3Set.length < S3_VARS.length) {
    const s3Missing = S3_VARS.filter((k) => !process.env[k]);
    console.error(`Incomplete S3 configuration. Missing variables: ${s3Missing.join(", ")}`);
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
  ADMIN_PASSWORD_MIN_LENGTH: Number(process.env.ADMIN_PASSWORD_MIN_LENGTH ?? "12"),
  SESSION_LIFETIME: process.env.SESSION_LIFETIME ?? "7d",
  CHILDREN_AGE_LIMIT: Number(process.env.CHILDREN_AGE_LIMIT ?? "12"),
  YOUTH_AGE_LIMIT: Number(process.env.YOUTH_AGE_LIMIT ?? "18"),
  ACTIVE_AGE_LIMIT: Number(process.env.ACTIVE_AGE_LIMIT ?? "65"),
  // Ehrungstermin (MM-DD): Datum, an dem Jubiläen geehrt werden
  ANNIVERSARY_CUTOFF: process.env.ANNIVERSARY_CUTOFF ?? "01-06",
  BACKUP_SCHEDULE: process.env.BACKUP_SCHEDULE ?? "0 2 * * 0",
  BACKUP_RETENTION_COUNT: Number(process.env.BACKUP_RETENTION_COUNT ?? "4"),
  BACKUP_LOCAL_PATH: process.env.BACKUP_LOCAL_PATH,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_REGION: process.env.S3_REGION,
  S3_PREFIX: process.env.S3_PREFIX,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  ZITADEL_WEBHOOK_SECRET_FILE: process.env.ZITADEL_WEBHOOK_SECRET_FILE,
};

export const ENV_META: { key: keyof typeof env; value: string | number | undefined }[] = [
  { key: "ORG_NAME",                  value: env.ORG_NAME },
  { key: "CHILDREN_AGE_LIMIT",        value: env.CHILDREN_AGE_LIMIT },
  { key: "YOUTH_AGE_LIMIT",           value: env.YOUTH_AGE_LIMIT },
  { key: "ACTIVE_AGE_LIMIT",          value: env.ACTIVE_AGE_LIMIT },
  { key: "ANNIVERSARY_CUTOFF",        value: env.ANNIVERSARY_CUTOFF },
  { key: "SESSION_LIFETIME",          value: env.SESSION_LIFETIME },
  { key: "ADMIN_PASSWORD_MIN_LENGTH", value: env.ADMIN_PASSWORD_MIN_LENGTH },
  { key: "BACKUP_SCHEDULE",           value: env.BACKUP_SCHEDULE },
  { key: "BACKUP_RETENTION_COUNT",    value: env.BACKUP_RETENTION_COUNT },
  { key: "BACKUP_LOCAL_PATH",         value: env.BACKUP_LOCAL_PATH },
  { key: "S3_ENDPOINT",               value: env.S3_ENDPOINT },
  { key: "S3_BUCKET",                 value: env.S3_BUCKET },
  { key: "SMTP_HOST",                 value: env.SMTP_HOST },
  { key: "SMTP_FROM",                 value: env.SMTP_FROM },
];
