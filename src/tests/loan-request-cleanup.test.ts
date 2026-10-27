import { describe, it, expect, vi, beforeEach } from "vitest";

let staleFixture: { id: string; personId: string }[] = [];
let memberRows: { id: string }[] = [];
let donorRows: { id: string }[] = [];
let loanRows: { id: string }[] = [];
let requestRows: { id: string }[] = [];
const deleteCalls: { table: string }[] = [];

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
  });
  return chain;
}

vi.mock("../db/index.js", () => ({
  db: {
    query: { loanRequests: { findMany: vi.fn(() => Promise.resolve(staleFixture)) } },
    select: vi.fn((cols: any) => ({
      from: vi.fn((table: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] ?? table?._?.name;
        if (name === "members") return chainOf(memberRows);
        if (name === "donors") return chainOf(donorRows);
        if (name === "lending_loans") return chainOf(loanRows);
        if (name === "loan_requests") return chainOf(requestRows);
        return chainOf([]);
      }),
    })),
    delete: vi.fn((table: any) => {
      const name = table?.[Symbol.for("drizzle:Name")] ?? table?._?.name;
      deleteCalls.push({ table: name });
      return { where: vi.fn(() => Promise.resolve(undefined)) };
    }),
  },
}));

const { cleanupRejectedLoanRequests } = await import("../lib/lending.js");

beforeEach(() => {
  staleFixture = [];
  memberRows = [];
  donorRows = [];
  loanRows = [];
  requestRows = [];
  deleteCalls.length = 0;
});

describe("cleanupRejectedLoanRequests", () => {
  it("does nothing when there are no stale requests", async () => {
    const count = await cleanupRejectedLoanRequests(90);
    expect(count).toBe(0);
    expect(deleteCalls.length).toBe(0);
  });

  it("deletes the request and the person when the person is unused elsewhere", async () => {
    staleFixture = [{ id: "req-1", personId: "person-1" }];
    const count = await cleanupRejectedLoanRequests(90);
    expect(count).toBe(1);
    expect(deleteCalls.map((c) => c.table)).toEqual(["loan_requests", "persons"]);
  });

  it("keeps the person when they're still a member", async () => {
    staleFixture = [{ id: "req-1", personId: "person-1" }];
    memberRows = [{ id: "m1" }];
    await cleanupRejectedLoanRequests(90);
    expect(deleteCalls.map((c) => c.table)).toEqual(["loan_requests"]);
  });

  it("keeps the person when they're a donor, have a loan, or have another request", async () => {
    for (const fixture of ["donorRows", "loanRows", "requestRows"] as const) {
      deleteCalls.length = 0;
      staleFixture = [{ id: "req-1", personId: "person-1" }];
      memberRows = [];
      donorRows = fixture === "donorRows" ? [{ id: "x" }] : [];
      loanRows = fixture === "loanRows" ? [{ id: "x" }] : [];
      requestRows = fixture === "requestRows" ? [{ id: "x" }] : [];
      await cleanupRejectedLoanRequests(90);
      expect(deleteCalls.map((c) => c.table)).toEqual(["loan_requests"]);
    }
  });
});
