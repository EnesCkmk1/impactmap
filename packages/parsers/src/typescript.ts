import ts from "typescript";
import {
  emptyResult,
  type LanguageParser,
  type ParsedExport,
  type ParsedImport,
  type ParsedName,
  type ParseInput,
  type ParseResult,
} from "./types.js";

const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

/**
 * Parses TypeScript and JavaScript with the TypeScript compiler API.
 * Symbol relationships recorded here are the ones that can be read from syntax:
 * import and export clauses, string-literal require and import(), and export declarations.
 * The parser does not run the type checker and does not infer dependencies from identifier names.
 */
export class TypeScriptParser implements LanguageParser {
  readonly id = "typescript-compiler-api";
  readonly languages = ["typescript", "javascript"] as const;
  readonly extensions = EXTENSIONS;

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return EXTENSIONS.some((extension) => lower.endsWith(extension));
  }

  parse(input: ParseInput): ParseResult {
    const language =
      input.path.endsWith(".ts") ||
      input.path.endsWith(".tsx") ||
      input.path.endsWith(".mts") ||
      input.path.endsWith(".cts")
        ? "typescript"
        : "javascript";
    try {
      const scriptKind = scriptKindFor(input.path);
      const sourceFile = ts.createSourceFile(
        input.path,
        input.source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
      );
      const result = emptyResult(language, "parsed");
      const parseDiagnostics =
        (
          sourceFile as ts.SourceFile & {
            parseDiagnostics?: readonly ts.Diagnostic[];
          }
        ).parseDiagnostics ?? [];
      for (const diagnostic of parseDiagnostics) {
        const position =
          diagnostic.start === undefined
            ? undefined
            : sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
        result.diagnostics.push({
          severity: "warning",
          code: "parse-error",
          message: ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n",
          ),
          ...(position ? { line: position.line + 1 } : {}),
        });
      }

      const locals = collectTopLevelDeclarations(sourceFile);
      for (const statement of sourceFile.statements) {
        collectStatement(sourceFile, statement, locals, result, false);
      }
      return result;
    } catch (error) {
      const failed = emptyResult(language, "error");
      failed.diagnostics.push({
        severity: "error",
        code: "parse-error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to parse source file.",
      });
      return failed;
    }
  }
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  if (lower.endsWith(".json")) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

interface LocalDeclaration {
  kind: ParsedExport["kind"];
  typeOnly: boolean;
  line: number;
  text: string;
}

function collectTopLevelDeclarations(
  sourceFile: ts.SourceFile,
): Map<string, LocalDeclaration> {
  const locals = new Map<string, LocalDeclaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, {
        kind: "function",
        typeOnly: false,
        line: lineOf(sourceFile, statement),
        text: collapse(statement.getText(sourceFile)),
      });
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, {
        kind: "class",
        typeOnly: false,
        line: lineOf(sourceFile, statement),
        text: collapse(statement.getText(sourceFile)),
      });
    } else if (ts.isInterfaceDeclaration(statement)) {
      locals.set(statement.name.text, {
        kind: "interface",
        typeOnly: true,
        line: lineOf(sourceFile, statement),
        text: collapse(statement.getText(sourceFile)),
      });
    } else if (ts.isTypeAliasDeclaration(statement)) {
      locals.set(statement.name.text, {
        kind: "type",
        typeOnly: true,
        line: lineOf(sourceFile, statement),
        text: collapse(statement.getText(sourceFile)),
      });
    } else if (ts.isEnumDeclaration(statement)) {
      locals.set(statement.name.text, {
        kind: "enum",
        typeOnly: false,
        line: lineOf(sourceFile, statement),
        text: collapse(statement.getText(sourceFile)),
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          locals.set(declaration.name.text, {
            kind: "variable",
            typeOnly: false,
            line: lineOf(sourceFile, declaration),
            text: collapse(declaration.getText(sourceFile)),
          });
        }
      }
    } else if (
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name)
    ) {
      locals.set(statement.name.text, {
        kind: "namespace",
        typeOnly: false,
        line: lineOf(sourceFile, statement),
        text: collapse(statement.getText(sourceFile)),
      });
    }
  }
  return locals;
}

function collectStatement(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  locals: Map<string, LocalDeclaration>,
  result: ParseResult,
  nested: boolean,
): void {
  if (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    const clause = node.importClause;
    const typeOnly = clause?.isTypeOnly ?? false;
    const names: ParsedName[] = [];
    if (clause?.name) {
      names.push({ imported: "default", local: clause.name.text, typeOnly });
    }
    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push({
          imported: "*",
          local: clause.namedBindings.name.text,
          typeOnly,
        });
      } else {
        for (const element of clause.namedBindings.elements) {
          names.push({
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
            typeOnly: typeOnly || element.isTypeOnly,
          });
        }
      }
    }
    result.imports.push(
      importRecord(
        sourceFile,
        node,
        node.moduleSpecifier.text,
        "static",
        typeOnly || (names.length > 0 && names.every((name) => name.typeOnly)),
        false,
        nested,
        names,
        false,
      ),
    );
    return;
  }

  if (ts.isExportDeclaration(node)) {
    const typeOnly = node.isTypeOnly;
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: ParsedName[] = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const imported = (element.propertyName ?? element.name).text;
          const exported = element.name.text;
          names.push({
            imported,
            local: exported,
            typeOnly: typeOnly || element.isTypeOnly,
          });
          result.exports.push({
            name: exported,
            kind: "reexport",
            typeOnly: typeOnly || element.isTypeOnly,
            line: lineOf(sourceFile, element),
            text: collapse(node.getText(sourceFile)),
          });
        }
      } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
        names.push({
          imported: "*",
          local: node.exportClause.name.text,
          typeOnly,
        });
        result.exports.push({
          name: node.exportClause.name.text,
          kind: "reexport",
          typeOnly,
          line: lineOf(sourceFile, node),
          text: collapse(node.getText(sourceFile)),
        });
      } else {
        names.push({ imported: "*", local: "*", typeOnly });
        result.exports.push({
          name: "*",
          kind: "reexport",
          typeOnly,
          line: lineOf(sourceFile, node),
          text: collapse(node.getText(sourceFile)),
        });
      }
      result.imports.push(
        importRecord(
          sourceFile,
          node,
          node.moduleSpecifier.text,
          "export-from",
          typeOnly,
          false,
          nested,
          names,
          false,
        ),
      );
    } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const localName = (element.propertyName ?? element.name).text;
        const exported = element.name.text;
        const local = locals.get(localName);
        result.exports.push({
          name: exported,
          kind: local?.kind ?? "unknown",
          typeOnly: element.isTypeOnly || (local?.typeOnly ?? false),
          line: local?.line ?? lineOf(sourceFile, element),
          text: local?.text ?? collapse(element.getText(sourceFile)),
        });
      }
    }
    return;
  }

  if (ts.isExportAssignment(node)) {
    result.exports.push({
      name: "default",
      kind: "unknown",
      typeOnly: false,
      line: lineOf(sourceFile, node),
      text: collapse(node.getText(sourceFile)),
    });
    return;
  }

  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const expression = node.moduleReference.expression;
    if (ts.isStringLiteral(expression)) {
      result.imports.push(
        importRecord(
          sourceFile,
          node,
          expression.text,
          "require",
          false,
          false,
          nested,
          [{ imported: "*", local: node.name.text, typeOnly: false }],
          false,
        ),
      );
    }
    return;
  }

  if (hasExportModifier(node) && isExportedDeclaration(node)) {
    pushExportedDeclaration(sourceFile, node, result);
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0]
  ) {
    const argument = node.arguments[0];
    if (ts.isStringLiteral(argument)) {
      result.imports.push(
        importRecord(
          sourceFile,
          node,
          argument.text,
          "dynamic",
          false,
          true,
          true,
          [],
          false,
        ),
      );
    } else {
      result.imports.push(
        importRecord(
          sourceFile,
          node,
          "<non-literal>",
          "dynamic",
          false,
          true,
          true,
          [],
          true,
        ),
      );
      result.diagnostics.push({
        severity: "info",
        code: "dynamic-import-non-literal",
        message:
          "Dynamic import() argument is not a string literal, so the target module was not resolved.",
        line: lineOf(sourceFile, node),
      });
    }
  }

  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    node.arguments[0] &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    result.imports.push(
      importRecord(
        sourceFile,
        node,
        node.arguments[0].text,
        "require",
        false,
        false,
        nested || !isTopLevel(node),
        [],
        false,
      ),
    );
  }

  if (ts.isImportTypeNode(node)) {
    const argument = node.argument;
    if (
      ts.isLiteralTypeNode(argument) &&
      ts.isStringLiteral(argument.literal)
    ) {
      result.imports.push(
        importRecord(
          sourceFile,
          node,
          argument.literal.text,
          "type-query",
          true,
          false,
          nested,
          [],
          false,
        ),
      );
    }
  }

  ts.forEachChild(node, (child) =>
    collectStatement(sourceFile, child, locals, result, true),
  );
}

function pushExportedDeclaration(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  result: ParseResult,
): void {
  const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  const typeOnly =
    ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
  const base = {
    typeOnly,
    line: lineOf(sourceFile, node),
    text: collapse(node.getText(sourceFile)),
  };
  if (ts.isFunctionDeclaration(node)) {
    result.exports.push({
      ...base,
      name: isDefault ? "default" : (node.name?.text ?? "default"),
      kind: "function",
    });
    return;
  }
  if (ts.isClassDeclaration(node)) {
    result.exports.push({
      ...base,
      name: isDefault ? "default" : (node.name?.text ?? "default"),
      kind: "class",
    });
    return;
  }
  if (ts.isInterfaceDeclaration(node)) {
    result.exports.push({
      ...base,
      name: node.name.text,
      kind: "interface",
      typeOnly: true,
    });
    return;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    result.exports.push({
      ...base,
      name: node.name.text,
      kind: "type",
      typeOnly: true,
    });
    return;
  }
  if (ts.isEnumDeclaration(node)) {
    result.exports.push({ ...base, name: node.name.text, kind: "enum" });
    return;
  }
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
    result.exports.push({ ...base, name: node.name.text, kind: "namespace" });
    return;
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        result.exports.push({
          name: declaration.name.text,
          kind: "variable",
          typeOnly: false,
          line: lineOf(sourceFile, declaration),
          text: collapse(declaration.getText(sourceFile)),
        });
      }
    }
  }
}

function importRecord(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  specifier: string,
  kind: ParsedImport["kind"],
  typeOnly: boolean,
  dynamic: boolean,
  conditional: boolean,
  names: ParsedName[],
  nonLiteral: boolean,
): ParsedImport {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return {
    specifier,
    kind,
    typeOnly,
    dynamic,
    conditional: conditional || dynamic,
    names,
    line: position.line + 1,
    column: position.character + 1,
    text: collapse(node.getText(sourceFile)),
    nonLiteral,
  };
}

function isExportedDeclaration(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isModuleDeclaration(node)
  );
}

function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isTopLevel(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isSourceFile(current)) return true;
    if (
      ts.isBlock(current) ||
      ts.isFunctionLike(current) ||
      ts.isClassLike(current)
    )
      return false;
    current = current.parent;
  }
  return false;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export const typescriptParser = new TypeScriptParser();
