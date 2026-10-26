import type {
  Cycle,
  DependencyEdge,
  GraphDocument,
  GraphNode,
  ImpactPath,
  ReachRecord,
  WalkOptions,
} from "./types.js";
import { GRAPH_DIRECTION_MEANING } from "./types.js";

const DEFAULT_WALK: WalkOptions = {
  maxDepth: 8,
  includeTypeOnly: true,
  includeDynamic: true,
  includeExternal: false,
  includeUnresolved: false,
};

/**
 * Directed dependency graph. Edges point from a module to the module it depends on.
 */
export class DependencyGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly outgoing = new Map<string, DependencyEdge[]>();
  private readonly incoming = new Map<string, DependencyEdge[]>();

  addNode(node: GraphNode): void {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, node);
      return;
    }
    this.nodes.set(node.id, {
      ...existing,
      ...node,
      exports: node.exports.length > 0 ? node.exports : existing.exports,
      diagnostics: dedupeDiagnostics([
        ...existing.diagnostics,
        ...node.diagnostics,
      ]),
      test: existing.test || node.test,
    });
  }

  addEdge(edge: DependencyEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(
        `Cannot add edge ${edge.from} -> ${edge.to} because one endpoint is missing from the graph.`,
      );
    }
    const out = this.outgoing.get(edge.from) ?? [];
    const duplicate = out.some(
      (existing) =>
        existing.to === edge.to &&
        existing.kind === edge.kind &&
        existing.typeOnly === edge.typeOnly &&
        existing.evidence.line === edge.evidence.line &&
        existing.evidence.text === edge.evidence.text,
    );
    if (duplicate) return;
    out.push(edge);
    this.outgoing.set(edge.from, out);
    const inc = this.incoming.get(edge.to) ?? [];
    inc.push(edge);
    this.incoming.set(edge.to, inc);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  allNodes(): GraphNode[] {
    return [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  allEdges(): DependencyEdge[] {
    return [...this.outgoing.values()]
      .flat()
      .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  }

  /** Modules this file depends on (outgoing edges). */
  dependenciesOf(id: string): DependencyEdge[] {
    return [...(this.outgoing.get(id) ?? [])].sort((a, b) =>
      edgeKey(a).localeCompare(edgeKey(b)),
    );
  }

  /** Modules that depend on this file (incoming edges). */
  dependentsOf(id: string): DependencyEdge[] {
    return [...(this.incoming.get(id) ?? [])].sort((a, b) =>
      edgeKey(a).localeCompare(edgeKey(b)),
    );
  }

  /**
   * Multi-source reverse breadth-first search.
   * Hop 0 is the changed file. Hop 1 is a direct dependent.
   */
  reverseReachable(
    starts: readonly string[],
    options: Partial<WalkOptions> = {},
  ): Map<string, ReachRecord> {
    const walk = { ...DEFAULT_WALK, ...options };
    const reached = new Map<string, ReachRecord>();
    const queue: string[] = [];

    for (const start of [...starts].sort()) {
      if (!this.nodes.has(start) || reached.has(start)) continue;
      reached.set(start, {
        node: start,
        hops: 0,
        source: start,
        previous: null,
        via: null,
      });
      queue.push(start);
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const info = reached.get(current);
      if (!info || info.hops >= walk.maxDepth) continue;
      const dependents = this.dependentsOf(current).filter((edge) =>
        edgeAllowed(edge, this, walk),
      );
      for (const edge of dependents) {
        if (reached.has(edge.from)) continue;
        reached.set(edge.from, {
          node: edge.from,
          hops: info.hops + 1,
          source: info.source,
          previous: current,
          via: edge,
        });
        queue.push(edge.from);
      }
    }

    return reached;
  }

  cycles(options: Partial<WalkOptions> = {}): Cycle[] {
    const walk = {
      ...DEFAULT_WALK,
      ...options,
      maxDepth: Number.POSITIVE_INFINITY,
    };
    const allowed = (edge: DependencyEdge) => edgeAllowed(edge, this, walk);
    const nodeIds = this.allNodes()
      .filter((node) => !node.external)
      .map((node) => node.id);
    const sccs = stronglyConnected(nodeIds, (id) =>
      this.dependenciesOf(id)
        .filter(allowed)
        .map((edge) => edge.to)
        .filter(
          (target) => this.nodes.has(target) && !this.node(target)?.external,
        ),
    );

    const cycles: Cycle[] = [];
    for (const component of sccs) {
      const members = new Set(component);
      const selfLoop =
        members.size === 1
          ? this.dependenciesOf(component[0] ?? "").find(
              (edge) => edge.to === edge.from && allowed(edge),
            )
          : undefined;
      if (members.size < 2 && !selfLoop) continue;

      const traced = traceCycle(members, (id) =>
        this.dependenciesOf(id).filter(allowed),
      );
      const pathEdges = traced.edges;
      cycles.push({
        members: [...members].sort(),
        path: traced.path,
        edges: pathEdges,
        typeOnly:
          pathEdges.length > 0 && pathEdges.every((edge) => edge.typeOnly),
      });
    }

    return cycles.sort((a, b) =>
      a.members.join("|").localeCompare(b.members.join("|")),
    );
  }

  toJSON(): GraphDocument {
    return {
      version: "1",
      direction: "dependency",
      directionMeaning: GRAPH_DIRECTION_MEANING,
      nodes: this.allNodes(),
      edges: this.allEdges(),
    };
  }
}

/**
 * Build an impact path from a reachability map. Prefer this over walking the graph
 * again so the path matches the breadth-first result exactly.
 */
export function impactPathFromMap(
  record: ReachRecord,
  reached: Map<string, ReachRecord>,
): ImpactPath {
  const reversedNodes: string[] = [];
  const reversedEdges: DependencyEdge[] = [];
  let cursor: ReachRecord | undefined = record;
  const guard = reached.size + 1;
  let steps = 0;
  while (cursor) {
    reversedNodes.push(cursor.node);
    if (cursor.via) reversedEdges.push(cursor.via);
    cursor = cursor.previous ? reached.get(cursor.previous) : undefined;
    steps += 1;
    if (steps > guard) break;
  }
  return {
    nodes: reversedNodes.reverse(),
    hops: record.hops,
    edges: reversedEdges.reverse(),
    source: record.source,
  };
}

export function edgeAllowed(
  edge: DependencyEdge,
  graph: DependencyGraph,
  options: WalkOptions,
): boolean {
  if (!options.includeUnresolved && !edge.resolved) return false;
  if (!options.includeTypeOnly && edge.typeOnly) return false;
  if (!options.includeDynamic && edge.dynamic) return false;
  const target = graph.node(edge.to);
  if (!options.includeExternal && target?.external) return false;
  return true;
}

function edgeKey(edge: DependencyEdge): string {
  return [
    edge.from,
    edge.to,
    edge.kind,
    String(edge.evidence.line),
    edge.evidence.text,
  ].join("\0");
}

function dedupeDiagnostics(
  items: GraphNode["diagnostics"],
): GraphNode["diagnostics"] {
  const seen = new Set<string>();
  const out = [];
  for (const item of items) {
    const key = `${item.code}\0${item.file ?? ""}\0${item.line ?? ""}\0${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Iterative Kosaraju. A recursive DFS would overflow the stack on a long dependency chain.
 */
function stronglyConnected(
  nodes: string[],
  outgoing: (id: string) => string[],
): string[][] {
  const ids = [...new Set(nodes)].sort();
  const known = new Set(ids);
  const order: string[] = [];
  const seen = new Set<string>();

  const postorder = (start: string): void => {
    const stack: Array<{ node: string; edges: string[]; index: number }> = [
      {
        node: start,
        edges: outgoing(start).filter((next) => known.has(next)),
        index: 0,
      },
    ];
    seen.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      if (frame.index >= frame.edges.length) {
        order.push(frame.node);
        stack.pop();
        continue;
      }
      const next = frame.edges[frame.index];
      frame.index += 1;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      stack.push({
        node: next,
        edges: outgoing(next).filter((item) => known.has(item)),
        index: 0,
      });
    }
  };

  for (const id of ids) {
    if (!seen.has(id)) postorder(id);
  }

  const incoming = new Map<string, string[]>();
  for (const id of ids) incoming.set(id, []);
  for (const id of ids) {
    for (const next of outgoing(id)) {
      if (!known.has(next)) continue;
      incoming.get(next)?.push(id);
    }
  }

  const components: string[][] = [];
  const assigned = new Set<string>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const start = order[index];
    if (!start || assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) break;
      component.push(node);
      for (const next of incoming.get(node) ?? []) {
        if (assigned.has(next)) continue;
        assigned.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function traceCycle(
  members: Set<string>,
  edgesFrom: (id: string) => DependencyEdge[],
): { path: string[]; edges: DependencyEdge[] } {
  const start = [...members].sort()[0];
  if (!start) return { path: [], edges: [] };

  const self = edgesFrom(start).find(
    (edge) => edge.to === start && members.has(edge.to),
  );
  if (members.size === 1 && self) {
    return { path: [start, start], edges: [self] };
  }

  const stack: Array<{ node: string; edge: DependencyEdge | null }> = [
    { node: start, edge: null },
  ];
  const onPath = new Set<string>([start]);

  const visit = (): { path: string[]; edges: DependencyEdge[] } | null => {
    const current = stack[stack.length - 1];
    if (!current) return null;
    const edges = edgesFrom(current.node)
      .filter((edge) => members.has(edge.to))
      .sort((a, b) => a.to.localeCompare(b.to));
    for (const edge of edges) {
      if (edge.to === start && stack.length > 1) {
        const path = stack.map((frame) => frame.node);
        path.push(start);
        const used = stack
          .slice(1)
          .map((frame) => frame.edge)
          .filter((item): item is DependencyEdge => item !== null);
        used.push(edge);
        return { path, edges: used };
      }
      if (onPath.has(edge.to)) continue;
      onPath.add(edge.to);
      stack.push({ node: edge.to, edge });
      const found = visit();
      if (found) return found;
      stack.pop();
      onPath.delete(edge.to);
    }
    return null;
  };

  return visit() ?? { path: [...members].sort(), edges: [] };
}
