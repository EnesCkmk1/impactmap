/**
 * Graph direction
 * ---------------
 * An edge `from → to` means `from` depends on `to` (for example, `from` imports `to`).
 * Forward traversal follows dependencies. Reverse traversal follows dependents and is
 * what change-impact analysis uses.
 *
 * Impact paths in reports are written in impact direction, from the changed module
 * toward the affected module, which is the reverse of edge direction:
 *
 *   changed.ts → dependent.ts → further-dependent.ts
 *
 * A static edge is a structural fact about source text. It is not proof that a runtime
 * execution reaches the dependency, and it is not proof that the dependent is broken.
 */

export type EdgeKind =
  | "import"
  | "require"
  | "export-from"
  | "dynamic"
  | "type-query";

export interface SourceEvidence {
  file: string;
  line: number;
  column: number;
  /** The import or export statement text that justified the edge. */
  text: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** True when the import is TypeScript `import type` or an inline type specifier. */
  typeOnly: boolean;
  /** True for `import()` expressions. */
  dynamic: boolean;
  /**
   * True when the specifier was resolved to a file that exists in the analyzed snapshot.
   * Unresolved imports and imports of deleted files are false.
   */
  resolved: boolean;
  /** True when the import sits below top level and may be conditional. */
  conditional: boolean;
  /** Imported or re-exported names. Empty for side-effect imports. */
  specifiers: string[];
  evidence: SourceEvidence;
}

export interface ExportedSymbol {
  /** Exported name. `default` is used for default exports. */
  name: string;
  kind:
    | "function"
    | "class"
    | "variable"
    | "type"
    | "interface"
    | "enum"
    | "reexport"
    | "namespace"
    | "unknown";
  typeOnly: boolean;
  line: number;
  /** Declaration text with collapsed whitespace. Compared between revisions. */
  text: string;
}

export type ParseStatus =
  | "parsed"
  | "error"
  | "unsupported"
  | "skipped"
  | "external"
  | "deleted";

export interface GraphDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface GraphNode {
  id: string;
  /** Repository-relative POSIX path, or an external id such as `external:lodash`. */
  path: string;
  language: string;
  packageName?: string;
  external: boolean;
  test: boolean;
  exports: ExportedSymbol[];
  parseStatus: ParseStatus;
  diagnostics: GraphDiagnostic[];
}

export interface WalkOptions {
  /** Maximum reverse hops from a changed file. Direct dependents are hop 1. */
  maxDepth: number;
  includeTypeOnly: boolean;
  includeDynamic: boolean;
  includeExternal: boolean;
  includeUnresolved: boolean;
}

export interface ReachRecord {
  node: string;
  hops: number;
  /** Changed file this path was traced from. */
  source: string;
  /** Node one hop closer to the changed file. Null for the changed file itself. */
  previous: string | null;
  /** Edge from this node to `previous` (this node imports previous). */
  via: DependencyEdge | null;
}

export interface ImpactPath {
  /** Impact direction: changed file first, affected file last. */
  nodes: string[];
  hops: number;
  edges: DependencyEdge[];
  source: string;
}

export interface Cycle {
  /** All members of the strongly connected component, sorted. */
  members: string[];
  /**
   * One concrete cycle in dependency direction, with the first node repeated at the end.
   * The component may contain additional edges beyond this path.
   */
  path: string[];
  edges: DependencyEdge[];
  typeOnly: boolean;
}

export interface GraphDocument {
  version: "1";
  direction: "dependency";
  directionMeaning: string;
  nodes: GraphNode[];
  edges: DependencyEdge[];
}

export const GRAPH_DIRECTION_MEANING =
  "An edge from A to B means A depends on B (A imports B). Impact paths are listed from the changed module toward affected modules, which follows reverse edges.";
