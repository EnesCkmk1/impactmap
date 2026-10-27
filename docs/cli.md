# CLI

```bash
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js impact --help
```

After `npm link`, the same commands are `impactmap --help`.

## Commands

### `analyze`

Scan the working tree. Exit 0, or 3 when the report is partial.

### `impact --base <ref>`

Compare changes since the merge base of `<ref>`.

| Option                             | Default                                                 | Notes                                               |
| ---------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `--head <ref>`                     | working tree                                            | A commit SHA or branch. Prefer a SHA in CI.         |
| `--depth <n>`                      | config, usually 8                                       | Integer 0 through 100.                              |
| `--fail-on never\|error\|warning`  | `never`                                                 | Does not read `ci.failOn`.                          |
| `--format text\|json\|files`       | `text`                                                  | `files` prints affected module paths, one per line. |
| `--output <file>`                  | stdout                                                  | Also writes the report.                             |
| `--graph neighborhood\|full\|none` | config                                                  |                                                     |
| `--no-cache`                       | cache enabled                                           |                                                     |
| `-c, --config <file>`              | discovery order in [configuration.md](configuration.md) |                                                     |

### `graph`

Prints the graph document (`direction`, nodes, edges). Exit 3 when analysis is partial.

### `cycles`

Prints the analysis report with cycle components. `--strict` exits 1 when a cycle exists and the report is complete. A partial report still exits 3.

### `tests --base <ref>`

Prints recommended test paths when `--format files` (the default for this command). JSON and text include the relationship and explanation.

`--run` appends those paths to `test.command` and spawns it with `shell: false`. ImpactMap does not claim those tests passed unless the command exits 0, and a passing command is not proof that the selection caught every regression. The GitHub Action never passes `--run`.

### `check --base <ref>`

Same report as `impact`. Exit code uses `--fail-on` if present, otherwise `ci.failOn`.

### `init`

Writes `impactmap.config.json` in the current directory. `--force` overwrites it. Exit 2 if the file exists and `--force` is omitted.

### `explain --base <ref>`

Prints a summary generated from the findings. With `--ai`, sends the payload described in [security.md](security.md) and prints the model text as commentary. Commentary cannot change findings or exit codes.

### `comment --report <file>`

Posts the report to a pull request. Requires `GITHUB_TOKEN`. `--repository owner/name` defaults to `GITHUB_REPOSITORY`. `--pr` defaults to the pull request number in `GITHUB_EVENT_PATH`. Owner, name, and pull request number are validated before the request.

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | Completed. `check` also uses 0 when no finding matches the failure policy.                       |
| 1    | `check` found a matching severity, `cycles --strict` found a cycle, or `tests --run` returned 1. |
| 2    | Usage, configuration, missing Git revision, or a missing tool such as Git.                       |
| 3    | Partial analysis, timeout, file-count limit, or an unexpected failure.                           |

`impact` without `--fail-on` stays at 0 when rules fail. Use `check` in CI when a rule should block the job.

## Missing inputs

- Not a Git repository: exit 2, code `not-a-repository`.
- Unknown revision: exit 2, code `bad-ref`.
- Invalid config: exit 2, code `config-invalid`, with the rejected path and message.
- Unsupported files are counted. They do not abort the run.
