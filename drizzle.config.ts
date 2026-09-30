import { defineConfig } from "drizzle-kit";
try { process.loadEnvFile(".env") } catch {}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
