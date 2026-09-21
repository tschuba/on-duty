import { describe, it, expect } from "vitest";
import { deriveMemberStatus } from "../lib/status.js";

const LIMIT = 18;
const TODAY = new Date();

function age(years: number, daysOffset = 0): string {
  const d = new Date(TODAY);
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

const activeRole = { id: "aktives_mitglied", title: "Aktives Mitglied", grantsActiveStatus: true };
const passiveRole = { id: "passives_mitglied", title: "Passives Mitglied", grantsActiveStatus: false };

function assignment(role: typeof activeRole, to: string | null = null) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    memberId: "00000000-0000-0000-0000-000000000002",
    memberRoleId: role.id,
    from: "2020-01-01",
    to,
    autoClosed: false,
    role,
  };
}

function member(overrides: Partial<{ exitDate: string | null; deathDate: string | null; birthDate: string }> = {}) {
  return {
    exitDate: null,
    deathDate: null,
    birthDate: age(30),
    ...overrides,
  };
}

describe("deriveMemberStatus", () => {
  it("archiviert when exitDate set", () => {
    expect(deriveMemberStatus(member({ exitDate: "2023-01-01" }), [assignment(activeRole)], LIMIT)).toBe("archiviert");
  });

  it("archiviert when deathDate set", () => {
    expect(deriveMemberStatus(member({ deathDate: "2023-01-01" }), [assignment(activeRole)], LIMIT)).toBe("archiviert");
  });

  it("archiviert takes priority over active role", () => {
    expect(deriveMemberStatus(member({ exitDate: "2023-01-01", deathDate: "2023-01-01" }), [assignment(activeRole)], LIMIT)).toBe("archiviert");
  });

  it("aktiv when open active-role assignment and age >= limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(25) }), [assignment(activeRole)], LIMIT)).toBe("aktiv");
  });

  it("jugend when open active-role assignment and age < limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(15) }), [assignment(activeRole)], LIMIT)).toBe("jugend");
  });

  it("jugend on exact day before birthday that would make limit", () => {
    // born exactly LIMIT years ago tomorrow → still one day short → jugend
    expect(deriveMemberStatus(member({ birthDate: age(LIMIT, 1) }), [assignment(activeRole)], LIMIT)).toBe("jugend");
  });

  it("aktiv on exact birthday reaching limit", () => {
    // born exactly LIMIT years ago today → age === limit → aktiv
    expect(deriveMemberStatus(member({ birthDate: age(LIMIT, 0) }), [assignment(activeRole)], LIMIT)).toBe("aktiv");
  });

  it("passiv when no active-role assignment", () => {
    expect(deriveMemberStatus(member(), [], LIMIT)).toBe("passiv");
  });

  it("passiv when only closed active-role assignment", () => {
    expect(deriveMemberStatus(member(), [assignment(activeRole, "2023-01-01")], LIMIT)).toBe("passiv");
  });

  it("passiv when only passive-role assignment (no grants_active_status)", () => {
    expect(deriveMemberStatus(member(), [assignment(passiveRole)], LIMIT)).toBe("passiv");
  });

  it("aktiv ignores passive-role assignment, counts open active-role", () => {
    expect(deriveMemberStatus(member(), [assignment(passiveRole), assignment(activeRole)], LIMIT)).toBe("aktiv");
  });
});
