import { parseSource } from "@impactmap/parsers";
import { describe, expect, it } from "vitest";

describe("TypeScript parser", () => {
  it("reads static imports, type imports, re-exports, dynamic imports, and require calls", () => {
    const result = parseSource({
      path: "src/mod.ts",
      source: `
        import { readSession } from "./auth/session.js";
        import type { Session } from "./auth/session.js";
        export { readSession } from "./auth/session.js";
        export function requireUser(token: string) { return token; }
        export const load = () => import("./plugins/math.js");
        export const missing = () => import("./" + "x");
        const legacy = require("./legacy.js");
        void legacy;
      `,
    });
    const specifiers = result.imports.map(
      (item) => `${item.kind}:${item.typeOnly}:${item.specifier}`,
    );
    expect(specifiers).toContain("static:false:./auth/session.js");
    expect(specifiers).toContain("static:true:./auth/session.js");
    expect(specifiers).toContain("export-from:false:./auth/session.js");
    expect(specifiers).toContain("dynamic:false:./plugins/math.js");
    expect(
      specifiers.filter((item) => item.includes("<non-literal>")),
    ).toHaveLength(1);
    expect(specifiers).toContain("require:false:./legacy.js");
    expect(result.exports.map((item) => item.name).sort()).toEqual([
      "load",
      "missing",
      "readSession",
      "requireUser",
    ]);
    expect(
      result.diagnostics.some(
        (item) => item.code === "dynamic-import-non-literal",
      ),
    ).toBe(true);
    expect(
      result.imports.filter(
        (item) =>
          item.specifier === "./auth/session.js" &&
          item.kind === "static" &&
          !item.typeOnly,
      ),
    ).toHaveLength(1);
  });
});

describe("Python parser", () => {
  it("ignores imports inside strings and comments", () => {
    const result = parseSource({
      path: "pkg/service.py",
      source: `
from pkg.repo import get_user
text = "import os"
# import hidden
def run_service(user_id):
    import json
    return get_user(user_id)
def _hidden():
    return 1
`,
    });
    expect(result.imports.map((item) => item.specifier).sort()).toEqual([
      "json",
      "pkg.repo",
    ]);
    expect(
      result.imports.find((item) => item.specifier === "json")?.conditional,
    ).toBe(true);
    expect(result.exports.map((item) => item.name)).toEqual(["run_service"]);
  });
});
