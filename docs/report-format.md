# Report format

`impactmap impact --format json` and `impactmap check --format json` print a version 1 report. `version` is `"1"` and `tool.name` is `"impactmap"`. The web explorer rejects files that fail that check.

`generatedAt` is omitted so two runs of the same inputs can be compared. `cache` still changes between a cold and a warm run. Compare `findings`, `tests`, `cycles`, and `summary` when you need a stable oracle. `repositoryRoot` is an absolute path on the machine that ran the analysis.

## Top-level fields

| Field         | Meaning                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comparison`  | Present when `--base` was set. `baseSha` and `headSha` are full SHAs. `mergeBase` is the comparison point. `headRef` is `WORKTREE` when uncommitted files are included.    |
| `summary`     | Counts of scanned, skipped, unsupported, and changed files, unresolved imports, non-literal dynamic imports, impact categories, cycles, test relationships, and `partial`. |
| `limitations` | Sentences the engine adds when resolution or coverage is incomplete.                                                                                                       |
| `diagnostics` | Structured messages such as `unresolved-import`, `deleted-import`, `dynamic-import-non-literal`, `escaped-symlink`, and parse warnings.                                    |
| `changes`     | Git name-status records: `added`, `modified`, `deleted`, `renamed`, `copied`, with `previousPath` on renames.                                                              |
| `findings`    | Impact and rule results.                                                                                                                                                   |
| `cycles`      | One entry per strongly connected component. `path` is a traced cycle. `edges` quote the imports.                                                                           |
| `tests`       | Recommendations.                                                                                                                                                           |
| `graph`       | Omitted when `output.graph` is `none`.                                                                                                                                     |
| `cache`       | Hit and miss counters. `resolutionReused` is true when the manifest was accepted.                                                                                          |

## Findings

`category` is `direct`, `transitive`, `interface`, or `architectural`.

`confidence` is `structural` for imports and declaration diffs, `configured` for explicit test mappings and rules you wrote, and `heuristic` is not used on findings. Test recommendations use `heuristic` for filename matches.

`impactPath` starts at the changed module. Each following file depends on the previous one.

`evidence` quotes the import or export line, with file, line, and column. Interface findings can have empty evidence and a `symbols` list of the exports whose text changed.

`severity` is `info` for direct, transitive, and interface findings. Architectural findings use the rule's `warning` or `error`.

## Tests

`relationship` is one of:

| Value                   | Meaning                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `structural-direct`     | The test file imports a changed file, including an import whose target was deleted.                                  |
| `structural-transitive` | The test imports a module that is on a reverse-dependency path from a change.                                        |
| `explicit-mapping`      | A `test.mappings` entry matched both the test and a changed module.                                                  |
| `heuristic-name`        | The test file name matches a changed file name by the documented convention, and no stronger relationship was found. |

The `files` format prints these paths and nothing else. It does not print whether the relationship was structural.

## Graph document

`impactmap graph` prints the graph package's document rather than the full impact report:

- `direction` is `dependency`
- `directionMeaning` states that edges point from importer to dependency
- each edge has `kind` (`import`, `require`, `export-from`, `dynamic`, `type-query`), `typeOnly`, `dynamic`, `resolved`, and `evidence`

Inside an impact report, `graph.nodes[].role` is `changed`, `direct`, `transitive`, `test`, `cycle`, `context`, or `external`, and `hop` is the reverse-dependency distance when the node was reached from a change.
