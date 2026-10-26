# ImpactMap

ImpactMap tells you which modules, packages, and tests are structurally connected to a code change before you merge it.

It reads source files, builds a dependency graph from real imports, compares Git revisions, and reports the evidence for every finding. It does not guess dependencies from filenames, and it does not need an LLM API key.

## Quick start

Requires Node.js 22 or newer and Git.

```bash
npm ci
npm run build
node packages/cli/dist/bin.js init
node packages/cli/dist/bin.js impact --base main
```

`npm link` from this repository exposes the `impactmap` command. The package is not published to npm yet.

Analysis is read-only. ImpactMap does not edit source files, create commits, merge pull requests, or deploy anything.

## What a change report answers

- Which modules import the changed file, directly or through other imports?
- Which packages sit on those paths?
- Which tests import the changed code, match a configured mapping, or only share a name?
- Did the change touch exported declaration text?
- Does the change cross a configured architecture rule or sit on a cycle?
- What was not analyzed?

A dependent module is not reported as broken. A static import is a structural fact, not proof of a runtime call.

## Example

This output is a real `impactmap impact --base main` run against a Git copy of [`fixtures/ts-basic`](fixtures/ts-basic) after `src/auth/session.ts` was edited. The full text is in [`docs/examples/ts-basic-impact.txt`](docs/examples/ts-basic-impact.txt). The commit prefix below is from that capture.

```text
ImpactMap
Base fba2806ab476 (main) → WORKTREE fba2806ab476
Scanned 12 files · skipped 4 · unresolved imports 1 · parse errors 0 · cycles 0

Changes (1)
  M src/auth/session.ts

Direct impact (4)
  INFO src/middleware/auth.ts directly depends on src/auth/session.ts
    path: src/auth/session.ts → src/middleware/auth.ts
    evidence: src/middleware/auth.ts:1 import { readSession } from "../auth/session.js";

Transitive impact (2)
  INFO src/routes/account.ts transitively depends on src/auth/session.ts
    path: src/auth/session.ts → src/middleware/auth.ts → src/routes/account.ts
    evidence: src/routes/account.ts:1 import { requireUser } from "../middleware/auth.js";

Tests (1)
  tests/session.test.ts
    structural-direct: tests/session.test.ts imports changed file src/auth/session.ts.
```

The same JSON report is the sample loaded by the local explorer (`npm run dev:web`, then **Load sample**).

## Commands

| Command                         | What it does                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `impactmap analyze`             | Scan the working tree. Report dependencies, cycles, and configured rules.     |
| `impactmap impact --base main`  | Compare the working tree with the merge base of `main`.                       |
| `impactmap graph`               | Write the dependency graph as JSON. Edges point from importer to dependency.  |
| `impactmap cycles`              | List strongly connected components. `--strict` exits 1 when one exists.       |
| `impactmap tests --base main`   | List recommended tests. `--run` executes `test.command` if you configured it. |
| `impactmap check --base main`   | Same analysis as `impact`, with `ci.failOn` deciding exit code 1.             |
| `impactmap init`                | Write `impactmap.config.json` and print the supported keys.                   |
| `impactmap explain --base main` | Print a deterministic summary. `--ai` is optional and off by default.         |

`--format json` is stable enough for automation. Exit codes are documented in [docs/cli.md](docs/cli.md).

## Language support

| Language    | Status in 0.1.0      | What is extracted                                                                                                                  |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript  | Supported            | Static imports and exports, `import type`, re-exports, literal `require` and `import()`, path aliases, workspace package `exports` |
| JavaScript  | Supported            | Same syntax parser as TypeScript                                                                                                   |
| Python      | Import-level         | `import` and `from ... import`, including parenthesized lists. Top-level `def` and `class` are recorded as exports.                |
| Other files | Reported, not parsed | Counted as unsupported. They do not become dependency edges.                                                                       |

See [docs/limitations.md](docs/limitations.md) before treating a report as complete.

## Repository layout

| Path               | Role                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `packages/core`    | Discovery, resolution, Git diffs, impact, tests, cache, public API        |
| `packages/parsers` | Language parsers behind `LanguageParser`                                  |
| `packages/graph`   | Directed graph, reverse reachability, cycles                              |
| `packages/config`  | Schema and validation. Unknown keys are rejected.                         |
| `packages/cli`     | `impactmap` command                                                       |
| `packages/github`  | Pull request comment rendering and permission constants                   |
| `apps/web`         | Optional local graph explorer. It reads a JSON report. It has no backend. |
| `fixtures`         | Repositories with known dependency shapes, used by tests                  |

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [CLI](docs/cli.md)
- [GitHub Actions](docs/github-actions.md)
- [Security and privacy](docs/security.md)
- [Performance](docs/performance.md)
- [Limitations](docs/limitations.md)
- [Report format](docs/report-format.md)
- [Adding a parser](docs/parsers.md)
- [Contributing](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)

## Development

```bash
npm ci
npm test
npm run lint
npm run build:web
```

`npm test` typechecks the packages and runs Vitest, including CLI tests against `packages/cli/dist`. Rebuild with `npm run build` after changing the engine if you run the CLI directly.

## License

MIT. Copyright 2026 EC. See [LICENSE](LICENSE).
