# Contributing

ImpactMap is an analysis tool. Changes should keep findings explainable and should fail closed when a relationship cannot be resolved.

## Setup

Node.js 22 or newer.

```bash
npm ci
npm test
npm run lint
```

`npm test` runs `tsc -b` and Vitest. CLI integration tests execute `packages/cli/dist/bin.js`, so a failing CLI test after an engine change usually means the build is stale. `npm test` rebuilds first.

The web app is typechecked separately:

```bash
npm run build:web
npm run dev:web
```

## Projects

| Area                          | Where to work                                             |
| ----------------------------- | --------------------------------------------------------- |
| Graph algorithms              | `packages/graph`                                          |
| Config schema                 | `packages/config/src/schema.ts`                           |
| Language parsers              | `packages/parsers` and [docs/parsers.md](docs/parsers.md) |
| Discovery, Git, impact, cache | `packages/core`                                           |
| CLI text and exit codes       | `packages/cli`                                            |
| Pull request comments         | `packages/github`                                         |
| Explorer                      | `apps/web`                                                |

## Tests

Fixture repositories in `fixtures/` are the oracles. Copy one with the helpers in `tests/helpers.ts`, put it in a temporary Git repository, and assert on paths and evidence from that tree. Do not use a language model to decide whether a finding is correct.

Add a fixture when you change resolution, impact categories, or rules. Prefer a small repository with one behavior over a snapshot of a large application.

## Configuration and docs

If you add a config field, validate it in `validateConfig`, reject unknown keys around it, document it in `docs/configuration.md`, and mention it in the `impactmap init` text. A field the engine ignores is a bug.

If you add a command, implement it before `impactmap --help` advertises it.

## Cache and secrets

Do not commit `.impactmap/`, `node_modules/`, or `dist/`. Do not commit API keys. `IMPACTMAP_AI_API_KEY` stays in the environment.

## Pull requests

Describe the behavior change, the fixture that locks it in, and any new limitation. The template in `.github/PULL_REQUEST_TEMPLATE.md` is the checklist.
