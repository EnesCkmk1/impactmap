import {
  type DependencyEdge,
  DependencyGraph,
  impactPathFromMap,
} from "@impactmap/graph";
import { describe, expect, it } from "vitest";

function edge(from: string, to: string, line = 1): DependencyEdge {
  return {
    from,
    to,
    kind: "import",
    typeOnly: false,
    dynamic: false,
    resolved: true,
    conditional: false,
    specifiers: ["value"],
    evidence: {
      file: from,
      line,
      column: 1,
      text: `import { value } from "./${to}"`,
    },
  };
}

function node(id: string) {
  return {
    id,
    path: id,
    language: "typescript",
    external: false,
    test: false,
    exports: [],
    parseStatus: "parsed" as const,
    diagnostics: [],
  };
}

describe("dependency graph", () => {
  it("walks reverse dependencies and reports one cycle component", () => {
    const graph = new DependencyGraph();
    for (const id of ["a.ts", "b.ts", "c.ts", "d.ts"]) graph.addNode(node(id));
    graph.addEdge(edge("b.ts", "a.ts"));
    graph.addEdge(edge("c.ts", "b.ts"));
    graph.addEdge(edge("a.ts", "c.ts"));
    graph.addEdge(edge("d.ts", "c.ts"));

    const reached = graph.reverseReachable(["a.ts"], { maxDepth: 5 });
    expect(reached.get("b.ts")?.hops).toBe(1);
    expect(reached.get("c.ts")?.hops).toBe(2);
    const record = reached.get("d.ts");
    expect(record).toBeDefined();
    if (!record) return;
    const path = impactPathFromMap(record, reached);
    expect(path.nodes).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(path.edges[0]?.from).toBe("b.ts");
    expect(path.edges[0]?.to).toBe("a.ts");

    const cycles = graph.cycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(cycles[0]?.path[0]).toBe(cycles[0]?.path.at(-1));
  });
});
