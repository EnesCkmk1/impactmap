# Security and privacy

ImpactMap is a local static-analysis tool. The default path does not send source code or reports anywhere.

## What stays on the machine

- Parsing, graph construction, Git diffs, rule checks, and test selection run in the local Node process.
- The cache is files under the configured directory inside the repository. Add `.impactmap/` to `.gitignore`. This repository already ignores it.
- The web explorer loads a JSON report from disk or from the dev server's `public/` sample. It has no account system and no backend.

## What the optional model request sends

`impactmap explain` without `--ai` does not make a network call.

`--ai` requires all of the following:

- `ai.enabled: true`
- `ai.endpoint` and `ai.model`
- `IMPACTMAP_AI_API_KEY` in the environment

The request is an OpenAI-compatible `POST` to `/chat/completions`. The body contains:

- a system prompt that tells the model not to invent files, imports, tests, or execution results
- a JSON payload with `summary`, `findings` (category, severity, title, explanation, impact path, rule name), `tests` (path, relationship, confidence, explanation), `limitations`, and the comparison SHAs when present

Source text is absent unless `ai.includeSource` is true. When it is true, the payload includes truncated text of changed files, up to `ai.maxSourceBytes` (default 8000), and the CLI prints that source is included before the request. Deleted files are not read for this payload. Paths are checked with a real-path boundary: a symlink or a sibling directory that shares the repository's path prefix is not read.

The model reply is printed as commentary. It does not alter findings, severities, or the exit code.

## Process and filesystem boundaries

- Git is executed as an argument array with `shell: false`.
- Refs are resolved to SHAs before diff.
- Discovery does not walk out of the repository root. Symlinks whose real path leaves the root are skipped and reported as `escaped-symlink`.
- Configuration paths must remain inside the root after `realpath`.
- `test.command` is an argv array and is spawned only for `impactmap tests --run`.

## Configuration code

`impactmap.config.mjs`, `.js`, `.cjs`, and `.ts` are executed. A repository can put arbitrary code there. Review those files the same way you review a build script. CI in the example workflows refuses them.

## GitHub token

Analysis workflows request `contents: read`. Comment publishing is a separate workflow that also requests `pull-requests: write`. Do not run that workflow with `pull_request_target` while executing pull request code. Details are in [github-actions.md](github-actions.md).

## Reporting a vulnerability

Open a private security advisory on the repository if the host supports it, or contact the maintainers listed on the project. Do not file a public issue containing a working exploit.
