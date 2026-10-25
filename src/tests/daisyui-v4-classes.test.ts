import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

it("nutzt keine daisyUI-v4-Klassen mehr", () => {
  const re = /form-control|label-text|input-bordered|select-bordered/;
  const hits = walk("src").filter((f) => f.endsWith(".tsx") && re.test(readFileSync(f, "utf8")));
  expect(hits).toEqual([]);
});
