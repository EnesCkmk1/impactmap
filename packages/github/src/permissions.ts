/**
 * Permissions the example workflows request.
 * Analysis never needs write access. Comment publishing is a separate workflow.
 */
export const ANALYSIS_PERMISSIONS = {
  contents: "read",
} as const;

export const COMMENT_PERMISSIONS = {
  contents: "read",
  "pull-requests": "write",
} as const;

export const FORK_WORKFLOW_RISKS = [
  "Prefer the pull_request event. It does not expose repository secrets to fork code.",
  "Do not use pull_request_target to checkout and execute pull request code with a privileged token.",
  "ImpactMap executes impactmap.config.ts and impactmap.config.mjs with the process privileges. The example action sets IMPACTMAP_DISABLE_CODE_CONFIG=1 so only JSON configuration is loaded.",
  "The example workflow does not run repository tests and does not pass a token to the analysis step.",
  "Comment publishing needs pull-requests: write. That permission can post a comment, and a compromised workflow could edit pull request text. Keep it in the separate comment workflow.",
];
