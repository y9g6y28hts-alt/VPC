import { describe, expect, it } from "vitest";
import { parseLocaleNumber } from "@/lib/forms";

describe("números en formato paraguayo", () => {
  it.each([
    ["365.000.000", 365_000_000],
    ["Gs. 1.500.000", 1_500_000],
    ["45.000,50", 45_000.5],
    ["US$ 78.000", 78_000],
    ["1500", 1500],
    ["12,5", 12.5],
    ["18", 18],
    ["9.5", 9.5],
    ["0", 0],
  ])("%s → %d", (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected);
  });
  it.each(["", "abc", "1.2.3,4,5", "12a"])("rechaza %s", (input) => {
    expect(parseLocaleNumber(input)).toBeNaN();
  });
});
