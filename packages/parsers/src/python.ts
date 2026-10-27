import {
  emptyResult,
  type LanguageParser,
  type ParsedExport,
  type ParsedImport,
  type ParseInput,
  type ParseResult,
} from "./types.js";

/**
 * Import-level Python parser.
 *
 * It tokenizes enough of the language to ignore comments and string literals, then
 * reads `import` and `from ... import` statements, including parenthesized name lists
 * and backslash continuations. It does not resolve attribute access, decorator
 * dependencies, or runtime imports built from variables.
 */
export class PythonParser implements LanguageParser {
  readonly id = "python-import-scanner";
  readonly languages = ["python"] as const;
  readonly extensions = [".py"];

  supports(filePath: string): boolean {
    return filePath.toLowerCase().endsWith(".py");
  }

  parse(input: ParseInput): ParseResult {
    const result = emptyResult("python", "parsed");
    let statements: string[];
    try {
      statements = logicalLines(input.source);
    } catch (error) {
      result.status = "error";
      result.diagnostics.push({
        severity: "error",
        code: "parse-error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to scan Python source.",
      });
      return result;
    }

    for (const statement of statements) {
      const parsed = parseImportStatement(statement);
      for (const item of parsed) result.imports.push(item);
      const exported = parseTopLevelDefinition(statement);
      if (exported) result.exports.push(exported);
    }
    return result;
  }
}

function splitMarked(statement: string): {
  lineNumber: number;
  raw: string;
  conditional: boolean;
} {
  const marker = statement.match(/^#L(\d+)#([\s\S]*)$/);
  const lineNumber = marker?.[1] ? Number(marker[1]) : 1;
  const raw = marker?.[2] ?? statement;
  return { lineNumber, raw, conditional: /^[ \t]/.test(raw) };
}

function parseImportStatement(statement: string): ParsedImport[] {
  const { lineNumber, raw, conditional } = splitMarked(statement);
  const line = raw.trim();
  if (line.startsWith("import ") && !line.startsWith("import(")) {
    const rest = line.slice("import ".length).trim();
    return rest
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .flatMap((part) => {
        const asMatch = part.match(
          /^([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?$/,
        );
        if (!asMatch?.[1]) return [];
        const imported = asMatch[1];
        return [
          {
            specifier: imported,
            kind: "static" as const,
            typeOnly: false,
            dynamic: false,
            conditional,
            names: [
              {
                imported,
                local: asMatch[2] ?? imported.split(".").pop() ?? imported,
                typeOnly: false,
              },
            ],
            line: lineNumber,
            column: 1,
            text: line,
            nonLiteral: false,
          },
        ];
      });
  }

  const from = line.match(/^from\s+(\.*)([A-Za-z_][\w.]*)?\s+import\s+(.+)$/);
  if (!from) return [];
  const dots = from[1] ?? "";
  const moduleName = from[2] ?? "";
  const specifier = `${dots}${moduleName}`;
  const importedPart = (from[3] ?? "").replace(/[()]/g, " ");
  const names = importedPart
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "\\")
    .map((part) => {
      const asMatch = part.match(
        /^([A-Za-z_*][\w]*)(?:\s+as\s+([A-Za-z_]\w*))?$/,
      );
      const imported = asMatch?.[1] ?? part;
      return { imported, local: asMatch?.[2] ?? imported, typeOnly: false };
    });
  return [
    {
      specifier,
      kind: "static",
      typeOnly: false,
      dynamic: false,
      conditional,
      names,
      line: lineNumber,
      column: 1,
      text: line,
      nonLiteral: false,
    },
  ];
}

function parseTopLevelDefinition(statement: string): ParsedExport | null {
  const { lineNumber, raw, conditional } = splitMarked(statement);
  if (conditional) return null;
  const line = raw.trim();
  const match = line.match(/^(def|class)\s+([A-Za-z_]\w*)/);
  if (!match?.[1] || !match[2]) return null;
  if (match[2].startsWith("_")) return null;
  return {
    name: match[2],
    kind: match[1] === "class" ? "class" : "function",
    typeOnly: false,
    line: lineNumber,
    text: line,
  };
}

/**
 * Returns logical statements with a `#L<n>#` prefix recording the starting line.
 * Parentheses and backslash continuations are joined. Strings and comments are blanked
 * so imports inside them are ignored, while real import text is preserved.
 */
function logicalLines(source: string): string[] {
  const kept: string[] = [];
  let current = "";
  let startLine = 1;
  let line = 1;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let i = 0;
  let pendingStart = true;

  const push = (): void => {
    const trimmedEnd = current.replace(/[ \t]+$/g, "");
    if (trimmedEnd.trim().length > 0) kept.push(`#L${startLine}#${trimmedEnd}`);
    current = "";
    pendingStart = true;
  };

  while (i < source.length) {
    const char = source[i] ?? "";
    if (pendingStart) {
      startLine = line;
      pendingStart = false;
    }

    if (char === "\n") {
      line += 1;
      if (paren === 0 && bracket === 0 && brace === 0) push();
      else current += " ";
      i += 1;
      continue;
    }

    if (char === "\\") {
      const next = source[i + 1];
      if (next === "\n") {
        line += 1;
        i += 2;
        current += " ";
        continue;
      }
    }

    if (char === "#") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      const triple = source.slice(i, i + 3);
      if (triple === "'''" || triple === '"""') {
        i += 3;
        while (i < source.length && source.slice(i, i + 3) !== triple) {
          if (source[i] === "\n") line += 1;
          i += 1;
        }
        i += 3;
        current += "''";
        continue;
      }
      i += 1;
      while (i < source.length && source[i] !== char) {
        if (source[i] === "\\") i += 2;
        else {
          if (source[i] === "\n") line += 1;
          i += 1;
        }
      }
      i += 1;
      current += "''";
      continue;
    }

    if (char === "(") paren += 1;
    else if (char === ")") paren = Math.max(0, paren - 1);
    else if (char === "[") bracket += 1;
    else if (char === "]") bracket = Math.max(0, bracket - 1);
    else if (char === "{") brace += 1;
    else if (char === "}") brace = Math.max(0, brace - 1);

    current += char;
    i += 1;
  }
  if (current.trim().length > 0) push();
  return kept;
}

export const pythonParser = new PythonParser();
