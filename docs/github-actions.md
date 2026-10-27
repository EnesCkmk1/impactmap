# GitHub Actions

Two workflows ship with this repository. Both request the minimum permission that their job uses.

## Analysis

[`.github/workflows/impactmap.yml`](../.github/workflows/impactmap.yml) runs on `pull_request`.

- Permission: `contents: read`.
- Checkout uses `fetch-depth: 0` and `ref: ${{ github.event.pull_request.head.sha }}` so the comparison has history and the analyzed commit is the pull request head.
- The local action is [`.github/actions/impactmap`](../.github/actions/impactmap/action.yml).
- `base` is `${{ github.event.pull_request.base.sha }}`, a SHA from the event, not a branch name interpolated into a shell string.
- The workflow command is `impact` with `fail-on: never`, so architecture findings are visible without failing this informational job. Switch the command to `check` and set `fail-on` to `error` or `warning` when a finding should fail the job.
- `IMPACTMAP_DISABLE_CODE_CONFIG=1` is set. A pull request that replaces `impactmap.config.json` with `impactmap.config.js` will not be executed.

The analysis step does not receive a token override and does not run `impactmap tests --run`.

## Comments

[`.github/workflows/impactmap-comment.yml`](../.github/workflows/impactmap-comment.yml) is `workflow_dispatch` only.

- Permissions: `contents: read` and `pull-requests: write`.
- `pull-requests: write` can post the ImpactMap comment. A compromised workflow with that permission can also change pull request text. Keep comment publishing in this separate workflow.
- Do not switch this workflow to `pull_request_target`. That event runs in the base repository with the base repository's credentials. Checking out pull request code in that context can expose those credentials to untrusted code.
- `pull_request` from a fork does not receive repository secrets. Prefer that event for any analysis that executes repository-controlled code. This repository's analysis workflow does not pass secrets into the analysis step.

The action publishes a comment only when `publish-comment` is `true`. That step uses the job's `GITHUB_TOKEN`. It does not invent a token.

## Forks

Treat pull request contents as untrusted input:

- Branch names, commit messages, and file paths are passed as arguments or environment values, not concatenated into a shell command.
- Source is parsed. It is not imported as an application module, except for an explicit JavaScript or TypeScript ImpactMap config, which CI disables.
- The report can quote source lines that the parser recorded as import evidence. Those lines are data in the report, not commands.

## Local check of the action script

The composite action selects `impactmap` on `PATH` or `node "$GITHUB_WORKSPACE/packages/cli/dist/bin.js"`. Tests in `tests/github.test.ts` assert the workflow permission blocks. They do not call the GitHub API. A live comment was not posted from the development environment.
