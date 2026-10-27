# Adding a parser

Parsers live in `packages/parsers` and implement `LanguageParser` from `packages/parsers/src/types.ts`.

```typescript
export interface LanguageParser {
  readonly id: string;
  readonly languages: readonly LanguageId[];
  readonly extensions: string[];
  supports(path: string): boolean;
  parse(input: ParseInput): ParseResult;
}
```

`ParseInput.path` is a repository-relative POSIX path. `ParseInput.source` is the file text. Return:

- `imports`: one entry per dependency you can actually read from syntax. Set `nonLiteral: true` when the specifier is computed and must not become an edge. Set `conditional: true` when the import is nested or otherwise optional.
- `exports`: public names you can defend. Use `kind` to describe the declaration. Include the declaration `text` when a later interface diff should see it.
- `diagnostics`: parse failures. A failure should set `status` to `"error"` and still return any imports recovered before the failure.
- `status`: `"parsed"`, `"error"`, or `"unsupported"`.

Do not create an edge because a filename string appears in a comment or a function body. The TypeScript parser and the Python scanner both ignore those.

## Registration

1. Add the class and a singleton next to `typescript.ts` or `python.ts`.
2. Include it in `builtinParsers()` in `packages/parsers/src/registry.ts`. `parseSource` picks the first parser whose `supports` returns true.
3. If the language needs its own module resolution, extend `resolveSpecifier` in `packages/core/src/resolve.ts` and keep unresolved specifiers out of the graph. The graph builder treats `status: "unresolved"` as a diagnostic, not an edge.
4. Add a fixture repository under `fixtures/` with a known import graph, and a Vitest file that asserts those edges. Follow `tests/parser.test.ts`.
5. Document the support level in the README table and in `docs/limitations.md`. Say what you do not resolve.

`PARSER_VERSION` in `packages/parsers/src/types.ts` is part of the cache key. Bump it when parsed edges can change for the same bytes.

## Resolution contract

The core asks a parser for specifiers, then resolves them. A parser should not read other files. Relative resolution, `tsconfig` paths, and workspace `package.json` `exports` stay in core so every language shares the repository boundary checks.

External packages use ids of the form `external:<package-name>`. Scope packages keep their scope (`external:@scope/name`).
