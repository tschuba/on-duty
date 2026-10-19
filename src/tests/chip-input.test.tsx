import { describe, it, expect } from "vitest";
import { ChipInput } from "../components/chip-input.js";

describe("ChipInput", () => {
  it("renders one hidden input per value, commas kept", () => {
    const html = String(<ChipInput name="numbers" label="N" values={["00 211 504", "a, b"]} />);
    expect(html.match(/type="hidden" name="numbers"/g)?.length).toBe(2);
    expect(html).toContain('value="a, b"');
  });
  it("carries limits and options as data attributes", () => {
    const html = String(<ChipInput name="x" label="L" maxFrom="#q" max={1} splitOnComma caseSensitive={false} />);
    expect(html).toContain('data-max-from="#q"');
    expect(html).toContain('data-split="1"');
    expect(html).toMatch(/data-case=""/);
  });
});
