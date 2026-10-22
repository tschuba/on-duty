import pino from "pino";

// Reads process.env directly: env.ts logs via this module, so importing it would be circular.
const pretty = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "development" ? "pretty" : "json")) === "pretty";

// Redaction is path-based only; free text is not scanned — log IDs, never names/emails/IBANs.
const SENSITIVE = ["email", "iban", "password", "authorization", "cookie"];

export function createLogger(destination?: pino.DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      redact: { paths: [...SENSITIVE, ...SENSITIVE.map((k) => `*.${k}`), "req.headers.authorization", "req.headers.cookie"], censor: "[REDACTED]" },
      ...(pretty && !destination ? { transport: { target: "pino-pretty" } } : {}),
    },
    destination,
  );
}

export const logger = createLogger();
