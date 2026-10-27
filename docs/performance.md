# Performance

Measurements below are single runs on the development machine that produced ImpactMap 0.1.0. They are not a statistical benchmark and they are not a claim about your repository. Re-run them locally before using the numbers to size a CI job.

## Method

`npm run benchmark` builds the packages and runs [`scripts/benchmark.mjs`](../scripts/benchmark.mjs).

The script creates a temporary Git repository of N TypeScript files (default 300). Each file imports the previous file. Every seventh file also imports one file further back. It commits a base revision, appends an export to `src/m0.ts`, and calls `runAnalysis` twice with `base: "HEAD"` and the default depth of 8. The first call fills the cache. The second should reuse parse entries and the resolution manifest.

A second measurement, not part of `npm run benchmark`, used a pure chain (no extra fan-in) at depths 8 and 100.

Environment: Node.js v22.23.4 on Linux, 26 October 2026 (Europe/Copenhagen).

## Results

Default benchmark script, 300 files, depth 8, one run:

|      | Time   | Graph                | Impact                                      |
| ---- | ------ | -------------------- | ------------------------------------------- |
| Cold | 166 ms | 301 nodes, 342 edges | 1 direct, 8 transitive                      |
| Warm | 52 ms  | same findings        | `parseHits` 301, resolution manifest reused |

Pure chain, one run each:

| Files | Depth |   Cold |  Warm | Direct | Transitive | Warm parse hits |
| ----- | ----: | -----: | ----: | -----: | ---------: | --------------: |
| 100   |     8 |  96 ms | 33 ms |      1 |          7 |             100 |
| 300   |     8 |  98 ms | 48 ms |      1 |          7 |             300 |
| 300   |   100 |  83 ms | 47 ms |      1 |         99 |             300 |
| 1000  |     8 | 189 ms | 80 ms |      1 |          7 |            1000 |
| 1000  |   100 | 144 ms | 81 ms |      1 |         99 |            1000 |

Cold times are not monotonic across these rows. A single sample moves with process and disk noise. What is stable in these runs: the warm pass reused every parsed file, and a 1000-file chain finished in well under a second.

Depth explains the impact counts. On a linear chain, hop 1 is the direct dependent and later hops are transitive. Depth 8 therefore reports 1 direct and 7 transitive modules. Depth 100 reports 1 direct and 99 transitive modules. The other files are parsed and present in the graph, and they are outside the configured impact depth.

## What the cache does not do

The warm run must not return edges from a different file set. The resolution manifest stores hashes of the config, resolver inputs, the file list, and the deleted set. Those checks are covered by `tests/cache.test.ts`. A mismatch re-resolves. Historical `--head` snapshots do not use the worktree cache.

## Limits

Defaults stop a run that exceeds 20,000 files, 2 MB in one file, 200 MB total, or 120 seconds. The report is marked `summary.partial` and the process exits 3 instead of returning a silent subset.
