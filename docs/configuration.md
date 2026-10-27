# Configuration

ImpactMap reads the first file it finds:

1. `impactmap.config.json`
2. `impactmap.config.mjs`
3. `impactmap.config.ts`
4. `impactmap.config.cjs`
5. `impactmap.config.js`

JSON is data. The other forms are executed with the privileges of the ImpactMap process. TypeScript configs must be self-contained: they are transpiled with `isolatedModules` and are not typechecked as a project. The GitHub Action sets `IMPACTMAP_DISABLE_CODE_CONFIG=1`, which refuses every non-JSON config.

Unknown keys are rejected. `impactmap init` prints the keys the engine implements. A missing file uses the defaults in `@impactmap/config`.

`--config <file>` selects one file. The path must stay inside the repository, including after symlink resolution.

## Example

This is the file `impactmap init` writes. Every rule type in it is implemented.

```json
{
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.mts",
    "**/*.cts",
    "**/*.py"
  ],
  "exclude": [
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/.venv/**",
    "**/venv/**",
    "**/*.min.js"
  ],
  "impact": {
    "depth": 8,
    "includeTypeOnly": true,
    "includeDynamic": true
  },
  "test": {
    "patterns": [
      "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}",
      "**/__tests__/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      "**/test_*.py",
      "**/*_test.py"
    ],
    "mappings": [
      {
        "name": "auth",
        "tests": ["tests/auth/**"],
        "modules": ["src/auth/**"]
      }
    ],
    "command": ["npm", "test", "--"]
  },
  "rules": [
    {
      "name": "domain-does-not-import-infra",
      "severity": "error",
      "type": "forbidden-dependency",
      "from": ["src/domain/**"],
      "to": ["src/infra/**"],
      "description": "Domain modules must not depend on infrastructure implementations."
    },
    {
      "name": "no-cycles",
      "severity": "warning",
      "type": "no-circular",
      "within": ["src/**"]
    },
    {
      "name": "web-cannot-import-secrets",
      "severity": "error",
      "type": "restricted-module",
      "modules": ["src/server/secrets.ts"],
      "importers": ["src/web/**"]
    },
    {
      "name": "public-api-review",
      "severity": "warning",
      "type": "public-api-review",
      "files": ["src/index.ts"]
    }
  ],
  "ci": { "failOn": "error" },
  "cache": { "enabled": true, "directory": ".impactmap/cache" },
  "ai": { "enabled": false, "includeSource": false }
}
```

`include` and `exclude` replace the default lists when set. `.git`, `node_modules`, and `.impactmap` are always skipped even if an include glob matches them.

## Fields

| Field                    | Meaning                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `impact.depth`           | Reverse-dependency hops. `1` reports direct dependents only. Maximum 100 on the CLI. Default 8.                    |
| `impact.includeTypeOnly` | Follow TypeScript `import type` and inline type specifiers.                                                        |
| `impact.includeDynamic`  | Follow `import("literal")`. Non-literal `import()` is never an edge.                                               |
| `test.patterns`          | Globs that mark a file as a test.                                                                                  |
| `test.mappings`          | Explicit associations. Each mapping needs `tests` and `modules` globs.                                             |
| `test.command`           | Argv array. Used only by `impactmap tests --run`. Analysis never runs it.                                          |
| `ci.failOn`              | `never`, `error`, or `warning`. Used by `impactmap check`. `impact` defaults to `never` unless `--fail-on` is set. |
| `cache.directory`        | Relative path inside the repo. `..` and absolute paths are rejected.                                               |
| `output.maxFindings`     | Default 1000. Extra findings are dropped and the report says it truncated them.                                    |
| `output.graph`           | `neighborhood` (default), `full`, or `none`.                                                                       |
| `limits.maxFiles`        | Default 20000. Above this, analysis exits 3.                                                                       |
| `limits.maxBytesPerFile` | Default 2000000. Larger files are skipped.                                                                         |
| `limits.maxTotalBytes`   | Default 200000000. The report is partial after this.                                                               |
| `limits.timeoutMs`       | Default 120000. The report is partial after this.                                                                  |
| `ai.enabled`             | Must be true before `impactmap explain --ai` will call a model.                                                    |
| `ai.endpoint`            | OpenAI-compatible base URL or a full `/chat/completions` URL.                                                      |
| `ai.model`               | Model name sent to that endpoint.                                                                                  |
| `ai.includeSource`       | When false, source text is not placed in the request. Default false.                                               |
| `ai.maxSourceBytes`      | Truncation cap for included source. Default 8000.                                                                  |

The API key is `IMPACTMAP_AI_API_KEY` in the environment. It is not a config field.

## Rules

All severities are `warning` or `error`. Direct, transitive, and interface findings are always `info` and do not fail CI. Rule findings use the severity on the rule.

| Type                   | Required fields        | Behavior                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forbidden-dependency` | `from`, `to`           | An edge whose importer matches `from` and whose target matches `to` is a violation. `to` may match `external:<package>`.                                                                                                                                      |
| `allowed-dependencies` | `from`, `allow`        | An importer matching `from` may only depend on targets matching `allow`.                                                                                                                                                                                      |
| `no-circular`          | none                   | Reports a strongly connected component. `within` limits the rule to components whose members all match.                                                                                                                                                       |
| `restricted-module`    | `modules`, `importers` | Importers matching `importers` must not depend on files matching `modules`.                                                                                                                                                                                   |
| `public-api-review`    | `files`                | Fires when the exported declaration text of a listed file changes between the base and head snapshots. A body-only edit is included when that body is part of the exported declaration. A change that does not alter exported declaration text does not fire. |

Unresolved imports are not rule-checked. Type-only and dynamic edges are. A violation is reported even when neither endpoint is in the diff, and the finding says so.

Globs are POSIX and are matched with `picomatch`.

## This repository

[`impactmap.config.json`](../impactmap.config.json) enables one error-level `no-circular` rule for `packages/**`. Fixture repositories under `fixtures/` carry their own configs and are separate Git roots when the tests copy them.
