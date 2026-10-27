export const PARSER_VERSION = "impactmap-parser-1";

export type LanguageId = "typescript" | "javascript" | "python" | "unknown";

export interface ParsedName {
  /** Name as exported or imported from the module specifier. `default` for default imports. */
  imported: string;
  local: string;
  typeOnly: boolean;
}

export interface ParsedImport {
  specifier: string;
  kind: "static" | "dynamic" | "require" | "export-from" | "type-query";
  typeOnly: boolean;
  dynamic: boolean;
  conditional: boolean;
  names: ParsedName[];
  line: number;
  column: number;
  text: string;
  /** True when the dynamic specifier is not a string literal and cannot be resolved. */
  nonLiteral: boolean;
}

export interface ParsedExport {
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
  text: string;
}

export interface ParseDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line?: number;
}

export interface ParseInput {
  /** Repository-relative POSIX path. */
  path: string;
  source: string;
}

export interface ParseResult {
  language: LanguageId;
  status: "parsed" | "error" | "unsupported";
  imports: ParsedImport[];
  exports: ParsedExport[];
  diagnostics: ParseDiagnostic[];
}

export interface LanguageParser {
  readonly id: string;
  readonly languages: readonly LanguageId[];
  readonly extensions: string[];
  supports(path: string): boolean;
  parse(input: ParseInput): ParseResult;
}

export function languageForPath(filePath: string): LanguageId {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  ) {
    return "typescript";
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "javascript";
  }
  return "unknown";
}

export function emptyResult(
  language: LanguageId,
  status: ParseResult["status"],
): ParseResult {
  return { language, status, imports: [], exports: [], diagnostics: [] };
}
