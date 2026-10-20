import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { SubNav } from "../components/sub-nav.js";

const render = async (n: unknown) => String(await (n as { toString(): Promise<string> | string }).toString());

describe("PageHeader", () => {
  it("renders h1, back link and actions", async () => {
    const html = await render(<PageHeader title="Titel" backHref="/liste" actions={<FormActions formId="f1" saveAndNew />} />);
    expect(html).toContain("<h1");
    expect(html).toContain('href="/liste"');
    expect(html).toContain('form="f1"');
    expect(html).toContain('value="save_and_new"');
  });
  it("gives every action aria-label and title; label hides per variant", async () => {
    const sec = await render(<HeaderAction icon="x-mark" label="Weg" href="/x" />);
    const pri = await render(<HeaderAction variant="primary" icon="check" label="Ok" form="f" />);
    expect(sec).toContain('aria-label="Weg"');
    expect(sec).toContain('title="Weg"');
    expect(sec).toContain("@max-xl:hidden");
    expect(pri).toContain("@max-md:hidden");
  });
});

describe("SubNav", () => {
  it("marks the active tab", async () => {
    const html = await render(<SubNav items={[{ href: "/a", label: "A", active: true }, { href: "/b", label: "B", active: false }]} />);
    expect(html).toContain("tab-active");
    expect(html.match(/tab-active/g)).toHaveLength(1);
  });
});

describe("no freestanding <h1> in routes", () => {
  it("only login keeps its own h1 (bare 403 strings are ignored) keep their own h1", () => {
    const dir = new URL("../routes/", import.meta.url);
    const offenders = readdirSync(dir).filter((f) => f !== "login.tsx" && /<h1\s/.test(readFileSync(new URL(f, dir), "utf8")));
    expect(offenders).toEqual([]);
  });
});
