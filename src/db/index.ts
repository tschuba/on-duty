import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/* v8 ignore start -- db client wiring, no branching logic to unit-test */
const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
/* v8 ignore stop */
