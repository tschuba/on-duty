import { describe, it, expect, vi } from "vitest";

const Pool = vi.fn(function () { return { end: vi.fn().mockResolvedValue(undefined) }; });
const drizzle = vi.fn(() => ({}));
const migrate = vi.fn().mockResolvedValue(undefined);
const runSeed = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => ({ Pool, default: { Pool } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
vi.mock("../db/seed.js", () => ({ runSeed }));
vi.mock("../index.js", () => ({}));

describe("db driver wiring", () => {
  it("db/index creates a pool from DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgres://test";
    const mod = await import("../db/index.js");
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: "postgres://test", max: 10 }));
    expect(mod.pool).toBeDefined();
    expect(mod.db).toBeDefined();
  });

  it("entrypoint migrates, seeds and closes its pool", async () => {
    await import("../entrypoint.js");
    expect(migrate).toHaveBeenCalled();
    expect(runSeed).toHaveBeenCalled();
    const pool = Pool.mock.results.at(-1)!.value;
    expect(pool.end).toHaveBeenCalled();
  });
});
