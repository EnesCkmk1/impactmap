# Roadmap

This file separates what 0.1.0 implements from later work. If a feature is listed here as planned, the CLI does not advertise it and the engine does not pretend to do it.

## Implemented in 0.1.0

- Repository discovery with gitignore, include and exclude globs, and monorepo `package.json` boundaries
- TypeScript and JavaScript parsing through the TypeScript compiler API
- Python import and top-level definition scanning
- Module resolution for relative files, TypeScript path aliases, and a practical subset of package `exports`
- Directed dependency graph, reverse reachability, shortest impact paths, and strongly connected components
- Git diff impact for added, modified, deleted, and renamed files, including a dirty working tree
- Interface findings from exported declaration text
- Test recommendations: structural, configured mappings, and filename heuristics
- Architecture rules: `forbidden-dependency`, `allowed-dependencies`, `no-circular`, `restricted-module`, `public-api-review`
- CLI commands: `analyze`, `impact`, `graph`, `cycles`, `tests`, `check`, `init`, `explain`, `comment`
- JSON reports and documented exit codes
- Parse and resolution cache with explicit invalidation
- Example GitHub Action and workflows with separate read and comment permissions
- Optional OpenAI-compatible commentary that cannot change findings
- Local graph explorer that reads a report file

## Planned

- Publishing a versioned npm package and a documented upgrade path beyond pulling this repository
- Symbol-level references from the TypeScript type checker, in addition to import specifiers
- A semantic API diff that can tell a signature change from a body-text change
- Call-graph or execution-path analysis, still labeled separately from structural imports
- Additional languages through the parser interface. Rust and Go are candidates. They are not parsed today.
- Editor and review-bot integrations beyond the GitHub comment command
- A live end-to-end test that posts a pull request comment against GitHub's API
- Resolution that can use the dependency tree recorded at a historical commit
- Incremental parsing inside a single file, not only per-file cache reuse

## Explicitly out of scope

- Modifying the repository under analysis, merging, or deploying
- Treating an LLM as the source of dependency edges
- Claiming that the selected tests prove a change is safe
