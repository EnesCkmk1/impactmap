import type { ImpactMapConfig } from "@impactmap/config";
import { ImpactMapError } from "./errors.js";
import type { ImpactReport } from "./report.js";

export interface Explanation {
  source: "deterministic" | "model";
  text: string;
  /** Files or fields that would be, or were, sent to a model. */
  transmitted: string[];
}

export interface AiPayload {
  kind: "impactmap-report-summary";
  notice: string;
  summary: ImpactReport["summary"];
  comparison?: ImpactReport["comparison"];
  findings: Array<
    Pick<
      ImpactReport["findings"][number],
      "category" | "severity" | "title" | "explanation" | "impactPath" | "rule"
    >
  >;
  tests: Array<
    Pick<
      ImpactReport["tests"][number],
      "file" | "relationship" | "confidence" | "explanation"
    >
  >;
  limitations: string[];
  source?: Array<{ file: string; content: string }>;
}

const SYSTEM_PROMPT = [
  "You explain a verified ImpactMap static-analysis report for a code reviewer.",
  "Use only the JSON you are given. Do not invent files, imports, tests, or execution results.",
  "Do not say a module is broken or that a test passed.",
  "Do not contradict architectural findings.",
  "If the report is uncertain, say so.",
].join(" ");

export function deterministicExplanation(report: ImpactReport): string {
  const lines = [
    "Deterministic summary of the ImpactMap report. This text is generated from the findings and is not a language-model commentary.",
    "",
    `Scanned ${report.summary.filesScanned} files. ${report.summary.changedFiles} changed. ${report.summary.directImpacts} direct and ${report.summary.transitiveImpacts} transitive dependents. ${report.summary.cycles} circular dependency component${report.summary.cycles === 1 ? "" : "s"}.`,
  ];
  if (report.summary.architecturalImpacts > 0) {
    lines.push(
      `${report.summary.architecturalImpacts} architectural finding${report.summary.architecturalImpacts === 1 ? "" : "s"}.`,
    );
  }
  const highlights = report.findings.slice(0, 8);
  if (highlights.length > 0) {
    lines.push("", "Findings:");
    for (const finding of highlights) {
      const path =
        finding.impactPath.length > 0
          ? ` Path: ${finding.impactPath.join(" → ")}.`
          : "";
      lines.push(`- [${finding.category}] ${finding.title}.${path}`);
    }
  }
  if (report.tests.length > 0) {
    lines.push("", "Tests to consider:");
    for (const test of report.tests.slice(0, 8)) {
      lines.push(`- ${test.file} (${test.relationship})`);
    }
  } else if (report.summary.changedFiles > 0) {
    lines.push("", "No structurally linked tests were identified.");
  }
  if (report.limitations.length > 0) {
    lines.push("", "Limitations:");
    for (const limitation of report.limitations.slice(0, 6))
      lines.push(`- ${limitation}`);
  }
  lines.push(
    "",
    "Static dependencies do not prove runtime behavior or the absence of regressions.",
  );
  return lines.join("\n");
}

export function buildAiPayload(
  report: ImpactReport,
  config: ImpactMapConfig,
  readFile?: (file: string) => string | null,
): AiPayload {
  const payload: AiPayload = {
    kind: "impactmap-report-summary",
    notice:
      "This payload is a summary of verified static analysis. It does not include source text unless includeSource is true.",
    summary: report.summary,
    ...(report.comparison ? { comparison: report.comparison } : {}),
    findings: report.findings.map((finding) => ({
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      explanation: finding.explanation,
      impactPath: finding.impactPath,
      ...(finding.rule ? { rule: finding.rule } : {}),
    })),
    tests: report.tests.map((test) => ({
      file: test.file,
      relationship: test.relationship,
      confidence: test.confidence,
      explanation: test.explanation,
    })),
    limitations: report.limitations,
  };
  if (config.ai.includeSource && readFile) {
    const snippets: Array<{ file: string; content: string }> = [];
    let used = 0;
    for (const change of report.changes) {
      if (change.status === "deleted") continue;
      if (used >= config.ai.maxSourceBytes) break;
      const text = readFile(change.path);
      if (!text) continue;
      const slice = text.slice(0, Math.max(0, config.ai.maxSourceBytes - used));
      snippets.push({ file: change.path, content: slice });
      used += slice.length;
    }
    payload.source = snippets;
    payload.notice =
      "This payload includes truncated source of changed files because ai.includeSource is true.";
  }
  return payload;
}

export function transmittedFields(payload: AiPayload): string[] {
  const fields = ["summary", "findings", "tests", "limitations"];
  if (payload.comparison) fields.push("comparison");
  if (payload.source && payload.source.length > 0) fields.push("source");
  return fields;
}

export async function requestModelCommentary(
  payload: AiPayload,
  config: ImpactMapConfig,
  fetcher: typeof globalThis.fetch,
): Promise<string> {
  if (!config.ai.enabled) {
    throw new ImpactMapError(
      "AI commentary is disabled in the configuration.",
      2,
      "ai-disabled",
    );
  }
  if (!config.ai.endpoint || !config.ai.model) {
    throw new ImpactMapError(
      "AI commentary requires ai.endpoint and ai.model.",
      2,
      "ai-unconfigured",
    );
  }
  const apiKey = process.env.IMPACTMAP_AI_API_KEY;
  if (!apiKey) {
    throw new ImpactMapError(
      "AI commentary requires IMPACTMAP_AI_API_KEY in the environment. The key is not read from the config file.",
      2,
      "ai-unconfigured",
    );
  }
  const endpoint = config.ai.endpoint.endsWith("/chat/completions")
    ? config.ai.endpoint
    : `${config.ai.endpoint.replace(/\/$/, "")}/chat/completions`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!response.ok) {
    throw new ImpactMapError(
      `AI endpoint returned HTTP ${response.status}.`,
      3,
      "ai-failed",
    );
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content;
  if (!text)
    throw new ImpactMapError(
      "AI endpoint returned an empty commentary.",
      3,
      "ai-failed",
    );
  return text;
}
