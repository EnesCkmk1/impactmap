import { useMemo, useState } from "react";
import type { Finding, ImpactReport, ReportEdge, ReportNode } from "./types";
import { isImpactReport } from "./types";

const ROLE_COLOR: Record<string, string> = {
  changed: "#1d4e89",
  direct: "#0f6e56",
  transitive: "#8a5a00",
  test: "#5b4b8a",
  cycle: "#9a3412",
  architectural: "#9a3412",
  context: "#57534e",
  external: "#78716c",
};

export function App() {
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [language, setLanguage] = useState("all");

  const findings = useMemo(() => {
    if (!report) return [];
    return report.findings.filter((finding) => {
      if (category !== "all" && finding.category !== category) return false;
      if (severity !== "all" && finding.severity !== severity) return false;
      if (
        query &&
        !`${finding.title} ${finding.impactPath.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [report, category, severity, query]);

  const visibleNodes = useMemo(() => {
    const nodes = report?.graph?.nodes ?? [];
    const ids = new Set<string>();
    if (category === "all" && severity === "all" && !query) {
      for (const node of nodes) ids.add(node.id);
    } else {
      for (const finding of findings) {
        for (const id of finding.impactPath) ids.add(id);
        if (finding.affectedFile) ids.add(finding.affectedFile);
        if (finding.changedFile) ids.add(finding.changedFile);
      }
    }
    return nodes.filter((node) => {
      if (!ids.has(node.id) && query)
        return node.path.toLowerCase().includes(query.toLowerCase());
      if (!ids.has(node.id)) return false;
      if (language !== "all" && node.language !== language) return false;
      return true;
    });
  }, [report, findings, category, severity, query, language]);

  const selectedFindings = findings.filter(
    (finding) =>
      finding.affectedFile === selected ||
      finding.changedFile === selected ||
      finding.impactPath.includes(selected ?? ""),
  );
  const cycleMembers = new Set(
    report?.cycles.flatMap((cycle) => cycle.members) ?? [],
  );

  async function loadSample() {
    setError(null);
    const response = await fetch("/sample-report.json");
    const json: unknown = await response.json();
    if (!isImpactReport(json)) {
      setError("The sample file is not an ImpactMap version 1 report.");
      return;
    }
    setReport(json);
    setSelected(json.changes[0]?.path ?? json.graph?.nodes[0]?.id ?? null);
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json: unknown = JSON.parse(String(reader.result));
        if (!isImpactReport(json)) {
          setError(
            "Choose a JSON report produced by impactmap impact or impactmap check.",
          );
          setReport(null);
          return;
        }
        setError(null);
        setReport(json);
        setSelected(json.changes[0]?.path ?? null);
      } catch {
        setError("That file is not valid JSON.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[#d9d2c5] bg-[#faf8f3] px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.18em] text-[#0f6e56] uppercase">
              ImpactMap
            </p>
            <h1 className="text-2xl font-semibold">Change impact</h1>
            <p className="max-w-2xl text-sm text-[#57534e]">
              Structural dependencies from the analysis engine. A highlighted
              module imports changed code. That does not mean it is broken.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded bg-[#1c1915] px-3 py-2 text-sm text-white"
              onClick={() => void loadSample()}
              type="button"
            >
              Load sample
            </button>
            <label className="rounded border border-[#d9d2c5] bg-white px-3 py-2 text-sm">
              Open report
              <input
                className="sr-only"
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) loadFile(file);
                }}
              />
            </label>
          </div>
        </div>
      </header>
      {error ? (
        <p className="px-6 py-3 text-sm text-[#9a3412]">{error}</p>
      ) : null}
      {!report ? (
        <section className="mx-auto max-w-xl px-6 py-16 text-sm leading-6">
          <p>
            Generate a report from a repository, then open it here. No account
            or server is required.
          </p>
          <pre className="mt-4 overflow-auto rounded bg-[#1c1915] p-4 text-[#f3f0e8]">{`impactmap impact --base main --format json --output impactmap-report.json`}</pre>
        </section>
      ) : (
        <div className="grid gap-4 px-4 py-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <section className="space-y-3">
            <Stats report={report} />
            <Filters
              query={query}
              category={category}
              severity={severity}
              language={language}
              onQuery={setQuery}
              onCategory={setCategory}
              onSeverity={setSeverity}
              onLanguage={setLanguage}
            />
            <ul className="max-h-[50vh] space-y-2 overflow-auto text-sm">
              {findings.slice(0, 80).map((finding) => (
                <li key={finding.id}>
                  <button
                    className="w-full rounded border border-[#d9d2c5] bg-white px-3 py-2 text-left"
                    onClick={() =>
                      setSelected(
                        finding.affectedFile ??
                          finding.changedFile ??
                          finding.impactPath[0] ??
                          null,
                      )
                    }
                    type="button"
                  >
                    <span className="text-xs uppercase text-[#57534e]">
                      {finding.category}
                    </span>
                    <span className="mt-1 block">{finding.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <GraphView
            nodes={visibleNodes}
            edges={(report.graph?.edges ?? []).filter(
              (edge) =>
                visibleNodes.some((node) => node.id === edge.from) &&
                visibleNodes.some((node) => node.id === edge.to),
            )}
            selected={selected}
            cycles={cycleMembers}
            onSelect={setSelected}
          />
          <Detail
            report={report}
            selected={selected}
            findings={selectedFindings}
          />
        </div>
      )}
    </main>
  );
}

function Stats({ report }: { report: ImpactReport }) {
  const items = [
    ["Changed", report.summary.changedFiles],
    ["Direct", report.summary.directImpacts],
    ["Transitive", report.summary.transitiveImpacts],
    ["Rules", report.summary.architecturalImpacts],
    ["Cycles", report.summary.cycles],
    [
      "Tests",
      report.summary.testsStructural +
        report.summary.testsHeuristic +
        report.summary.testsConfigured,
    ],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded border border-[#d9d2c5] bg-white px-2 py-2"
        >
          <dt className="text-xs text-[#57534e]">{label}</dt>
          <dd className="text-lg font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Filters(props: {
  query: string;
  category: string;
  severity: string;
  language: string;
  onQuery: (value: string) => void;
  onCategory: (value: string) => void;
  onSeverity: (value: string) => void;
  onLanguage: (value: string) => void;
}) {
  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={(event) => event.preventDefault()}
    >
      <input
        className="w-full rounded border border-[#d9d2c5] bg-white px-2 py-2"
        placeholder="Search files or paths"
        value={props.query}
        onChange={(event) => props.onQuery(event.target.value)}
        aria-label="Search files or paths"
      />
      <select
        className="w-full rounded border border-[#d9d2c5] bg-white px-2 py-2"
        value={props.category}
        onChange={(event) => props.onCategory(event.target.value)}
        aria-label="Impact category"
      >
        <option value="all">All categories</option>
        <option value="direct">Direct</option>
        <option value="transitive">Transitive</option>
        <option value="interface">Interface</option>
        <option value="architectural">Architectural</option>
      </select>
      <select
        className="w-full rounded border border-[#d9d2c5] bg-white px-2 py-2"
        value={props.severity}
        onChange={(event) => props.onSeverity(event.target.value)}
        aria-label="Severity"
      >
        <option value="all">All severities</option>
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="error">Error</option>
      </select>
      <select
        className="w-full rounded border border-[#d9d2c5] bg-white px-2 py-2"
        value={props.language}
        onChange={(event) => props.onLanguage(event.target.value)}
        aria-label="Language"
      >
        <option value="all">All languages</option>
        <option value="typescript">TypeScript</option>
        <option value="javascript">JavaScript</option>
        <option value="python">Python</option>
      </select>
    </form>
  );
}

function GraphView(props: {
  nodes: ReportNode[];
  edges: ReportEdge[];
  selected: string | null;
  cycles: Set<string>;
  onSelect: (id: string) => void;
}) {
  const edges = props.edges ?? [];
  if (props.nodes.length === 0) {
    return (
      <section className="rounded border border-dashed border-[#d9d2c5] p-6 text-sm">
        No modules match the current filters.
      </section>
    );
  }
  if (props.nodes.length > 60) {
    return (
      <section className="rounded border border-[#d9d2c5] bg-white p-6 text-sm">
        This neighborhood has {props.nodes.length} modules. Search or filter
        before drawing them. The list on the left stays available.
      </section>
    );
  }
  const columns = new Map<number, ReportNode[]>();
  for (const node of props.nodes) {
    const hop = node.hop ?? (node.role === "changed" ? 0 : 3);
    const list = columns.get(hop) ?? [];
    list.push(node);
    columns.set(hop, list);
  }
  const hops = [...columns.keys()].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  hops.forEach((hop, column) => {
    (columns.get(hop) ?? []).forEach((node, row) => {
      positions.set(node.id, { x: 24 + column * 230, y: 24 + row * 52 });
    });
  });
  const width = 24 + hops.length * 230 + 160;
  const height =
    48 + Math.max(...[...columns.values()].map((list) => list.length), 1) * 52;

  return (
    <section className="overflow-auto rounded border border-[#d9d2c5] bg-white">
      <div className="flex flex-wrap gap-3 border-b border-[#d9d2c5] px-3 py-2 text-xs text-[#57534e]">
        {Object.entries(ROLE_COLOR).map(([role, color]) => (
          <span key={role} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: color }}
            />
            {role}
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Dependency neighborhood"
      >
        {edges.map((edge) => {
          const from = positions.get(edge.to);
          const to = positions.get(edge.from);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.evidence.line}`}
              x1={from.x + 180}
              y1={from.y + 16}
              x2={to.x}
              y2={to.y + 16}
              stroke={
                props.cycles.has(edge.from) && props.cycles.has(edge.to)
                  ? "#9a3412"
                  : "#c4bdb2"
              }
              strokeWidth={
                props.cycles.has(edge.from) && props.cycles.has(edge.to) ? 2 : 1
              }
            />
          );
        })}
        {props.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const active = node.id === props.selected;
          return (
            <foreignObject
              key={node.id}
              x={position.x}
              y={position.y}
              width="180"
              height="36"
            >
              <div>
                <button
                  type="button"
                  className="h-9 w-full truncate rounded-md border px-2 text-left font-mono text-[11px]"
                  style={{
                    background: active ? "#1c1915" : "#ffffff",
                    color: active ? "#f3f0e8" : "#1c1915",
                    borderColor: active
                      ? "#1c1915"
                      : (ROLE_COLOR[node.role] ?? "#d9d2c5"),
                  }}
                  onClick={() => props.onSelect(node.id)}
                >
                  {shorten(node.path)}
                </button>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </section>
  );
}

function Detail({
  report,
  selected,
  findings,
}: {
  report: ImpactReport;
  selected: string | null;
  findings: Finding[];
}) {
  const tests = report.tests.filter(
    (test) =>
      test.file === selected || test.relatedFiles.includes(selected ?? ""),
  );
  return (
    <aside className="space-y-3 text-sm">
      <div className="rounded border border-[#d9d2c5] bg-white p-3">
        <h2 className="font-semibold">{selected ?? "Select a module"}</h2>
        <p className="mt-2 text-[#57534e]">{report.graph?.directionMeaning}</p>
        {report.comparison ? (
          <p className="mt-2 font-mono text-xs">
            {report.comparison.mergeBase.slice(0, 12)} →{" "}
            {report.comparison.headSha.slice(0, 12)}
          </p>
        ) : null}
      </div>
      {findings.map((finding) => (
        <article
          key={finding.id}
          className="rounded border border-[#d9d2c5] bg-white p-3"
        >
          <p className="text-xs uppercase text-[#57534e]">
            {finding.severity} · {finding.category} · {finding.confidence}
          </p>
          <h3 className="mt-1 font-semibold">{finding.title}</h3>
          <p className="mt-2 leading-5">{finding.explanation}</p>
          {finding.impactPath.length > 1 ? (
            <ol className="mt-2 space-y-1 font-mono text-xs">
              {finding.impactPath.map((file, index) => (
                <li key={`${finding.id}-${file}`}>
                  {index + 1}. {file}
                </li>
              ))}
            </ol>
          ) : null}
          {finding.evidence.slice(0, 4).map((evidence) => (
            <p
              key={`${evidence.file}:${evidence.line}:${evidence.text}`}
              className="mt-2 font-mono text-xs text-[#44403c]"
            >
              {evidence.file}:{evidence.line} {evidence.text}
            </p>
          ))}
        </article>
      ))}
      {tests.map((test) => (
        <article
          key={test.file + test.relationship}
          className="rounded border border-[#d9d2c5] bg-white p-3"
        >
          <p className="text-xs uppercase text-[#57534e]">
            {test.relationship}
          </p>
          <h3 className="font-mono text-xs">{test.file}</h3>
          <p className="mt-2">{test.explanation}</p>
        </article>
      ))}
      {report.limitations.length > 0 ? (
        <div className="rounded border border-[#d9d2c5] bg-white p-3">
          <h2 className="font-semibold">Limitations</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {report.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

function shorten(file: string): string {
  return file.length > 26 ? `…${file.slice(-25)}` : file;
}
