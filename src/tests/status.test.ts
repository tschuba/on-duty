import { describe, it, expect } from "vitest";
import { deriveMemberStatus } from "../lib/status.js";

const YOUTH_LIMIT = 18;
const CHILDREN_LIMIT = 12;
const TODAY = new Date();

function age(years: number, daysOffset = 0): string {
  const d = new Date(TODAY);
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + daysOffset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const activeRole = { id: "aktives_mitglied", title: "Aktives Mitglied", grantsActiveStatus: true, isProtected: false, sortOrder: 0, typeId: "t1" };
const passiveRole = { id: "passives_mitglied", title: "Passives Mitglied", grantsActiveStatus: false, isProtected: false, sortOrder: 0, typeId: "t1" };

function assignment(role: typeof activeRole, to: string | null = null) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    memberId: "00000000-0000-0000-0000-000000000002",
    memberRoleId: role.id,
    from: "2020-01-01",
    to,
    autoClosed: false,
    note: null,
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
  it("ausgetreten when exitDate set", () => {
    expect(deriveMemberStatus(member({ exitDate: "2023-01-01" }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("ausgetreten");
  });

  it("verstorben when deathDate set", () => {
    expect(deriveMemberStatus(member({ deathDate: "2023-01-01" }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("verstorben");
  });

  it("verstorben takes priority over exitDate and active role", () => {
    expect(deriveMemberStatus(member({ exitDate: "2023-01-01", deathDate: "2023-01-01" }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("verstorben");
  });

  it("aktiv when open active-role assignment and age >= youth limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(25) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("aktiv");
  });

  it("jugend when open active-role assignment and age between limits", () => {
    expect(deriveMemberStatus(member({ birthDate: age(15) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("jugend");
  });

  it("jugend on exact day before birthday that would reach youth limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(YOUTH_LIMIT, 1) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("jugend");
  });

  it("aktiv on exact birthday reaching youth limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(YOUTH_LIMIT, 0) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("aktiv");
  });

  it("kinder when open active-role assignment and age < children limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(8) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("kinder");
  });

  it("kinder on exact day before birthday that would reach children limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(CHILDREN_LIMIT, 1) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("kinder");
  });

  it("jugend on exact birthday reaching children limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(CHILDREN_LIMIT, 0) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("jugend");
  });

  it("foerdernd when no active-role assignment", () => {
    expect(deriveMemberStatus(member(), [], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("foerdernd");
  });

  it("foerdernd when active role ended before the age limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(70) }), [assignment(activeRole, "2020-06-01")], CHILDREN_LIMIT, YOUTH_LIMIT, 65)).toBe("foerdernd");
  });

  it("foerdernd under limit with only non-granting role", () => {
    expect(deriveMemberStatus(member(), [assignment(passiveRole)], CHILDREN_LIMIT, YOUTH_LIMIT)).toBe("foerdernd");
  });

  it("passiv when open active role and age limit reached", () => {
    expect(deriveMemberStatus(member({ birthDate: age(66) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT, 65)).toBe("passiv");
  });

  it("passiv when active role ended after the age limit", () => {
    expect(deriveMemberStatus(member({ birthDate: age(70) }), [assignment(activeRole, "2030-01-01".replace("2030", String(new Date().getFullYear() - 1)))], CHILDREN_LIMIT, YOUTH_LIMIT, 65)).toBe("passiv");
  });

  it("aktiv on day before age limit, passiv on the limit day", () => {
    expect(deriveMemberStatus(member({ birthDate: age(65, 1) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT, 65)).toBe("aktiv");
    expect(deriveMemberStatus(member({ birthDate: age(65, 0) }), [assignment(activeRole)], CHILDREN_LIMIT, YOUTH_LIMIT, 65)).toBe("passiv");
  });
});
