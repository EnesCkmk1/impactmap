# Limitations

ImpactMap 0.1.0 reports structural relationships it can defend from source text and Git. It does not know which of those relationships run in production.

## Always true of a report

- A direct or transitive finding means "this module imports a changed module, or imports something that does." It does not mean the module is broken.
- Interface findings compare exported declaration text. When the export is a function declaration, the body is part of that text. A whitespace or comment change inside the body can count. The finding is not a semantic breaking-change verdict.
- `public-api-review` uses the same declaration text. An edit that leaves the export clause unchanged, and does not change a directly exported declaration, does not fire the rule.
- Recommended tests were not executed unless you passed `impactmap tests --run`. A green run of the selected command does not prove the absence of regressions.
- Dynamic `import()` with a non-literal specifier is a diagnostic, not an edge.
- Unresolved imports are listed and are not followed. Architecture rules do not evaluate them.
- Bare specifiers that do not match a workspace package become `external:<name>` nodes. ImpactMap does not prove the package is installed, and it does not open files inside `node_modules`.
- Revision mode reads that commit's source. It does not reconstruct that commit's installed dependencies. Resolution can differ from a machine that has `npm install` at that revision.

## TypeScript and JavaScript

The parser uses the TypeScript compiler API syntax tree. It does not run the type checker.

Recorded relationships are import and export clauses, string-literal `require()` and `import()`, and export declarations. A mention of a filename or an identifier in a comment, string, or function body is not a dependency.

Known gaps:

- `require("literal")` can match a user function named `require`. `createRequire` is not handled.
- `declare module` augmentation is incomplete.
- Package `exports` resolution covers string targets, the `import`, `default`, `require`, and `types` conditions, and one-star patterns. Conditional exports beyond that fall through to the TypeScript resolver or stay unresolved.
- Path aliases come from the nearest `tsconfig.json` / `jsconfig.json`. Project references are not loaded as separate programs.
- JavaScript without a `tsconfig` still resolves relative files and workspace packages. Type-only syntax does not apply.

## Python

The Python parser is an import scanner. It skips strings and comments, joins parenthesized and backslash-continued imports, and marks indented imports as conditional. It records top-level function and class definitions as exports.

It does not resolve attribute access, importlib, or imports built from variables. A relative `from . import name` can resolve to a submodule file in the repository. An absolute import resolves internally only when a matching repository path exists; otherwise it is external.

## Graph and rules

- Cycle reports are strongly connected components, plus one traced path. They are not an enumeration of every simple cycle.
- Self-imports are cycles.
- Rule globs match repository-relative POSIX paths and `external:` ids. They do not match symbols.
- Findings are capped by `output.maxFindings`.

## Explorer

The web app draws the graph embedded in a version 1 report. It does not re-analyze the repository. Graphs above 60 nodes stay as a list until a filter reduces them.
