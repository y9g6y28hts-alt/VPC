import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo ESM sin tipos
import { buildSqlBundle } from "../../scripts/bundle-sql.mjs";

describe("SQL de la demo autónoma", () => {
  it("el módulo generado coincide con supabase/migrations", () => {
    const current = readFileSync("src/server/demo/sql-bundle.generated.ts", "utf8");
    expect(current, "Ejecute: node scripts/bundle-sql.mjs").toBe(buildSqlBundle());
  });
});
