import fs from "node:fs";
import path from "node:path";
import type { DependencyEdge, GraphDiagnostic } from "@impactmap/graph";
import { PARSER_VERSION, type ParseResult } from "@impactmap/parsers";
import { isInside, sha256 } from "./paths.js";

export interface CacheStats {
  enabled: boolean;
  parseHits: number;
  parseMisses: number;
  resolutionReused: boolean;
}

export interface ResolutionManifest {
  version: 1;
  parserVersion: string;
  configHash: string;
  resolverHash: string;
  fileSetHash: string;
  deletedHash: string;
  files: Record<
    string,
    {
      contentHash: string;
      edges: DependencyEdge[];
      diagnostics: GraphDiagnostic[];
    }
  >;
}

/**
 * Per-file parse cache keyed by parser version and content hash.
 * Resolution edges are reused only when the config, resolver inputs, and file set match.
 * A changed source file is re-resolved. Added or deleted paths invalidate every edge.
 */
export class AnalysisCache {
  private readonly directory: string;
  parseHits = 0;
  parseMisses = 0;
  resolutionReused = false;

  constructor(repoRoot: string, relativeDirectory: string) {
    const resolved = path.resolve(repoRoot, relativeDirectory);
    if (!isInside(repoRoot, resolved)) {
      throw new Error("Cache directory must stay inside the repository.");
    }
    this.directory = resolved;
  }

  stats(): CacheStats {
    return {
      enabled: true,
      parseHits: this.parseHits,
      parseMisses: this.parseMisses,
      resolutionReused: this.resolutionReused,
    };
  }

  getParse(contentHash: string): ParseResult | null {
    const file = this.parseFile(contentHash);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        version?: string;
        result?: ParseResult;
      };
      if (parsed.version !== PARSER_VERSION || !parsed.result) return null;
      this.parseHits += 1;
      return parsed.result;
    } catch {
      return null;
    }
  }

  setParse(contentHash: string, result: ParseResult): void {
    this.parseMisses += 1;
    const file = this.parseFile(contentHash);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, JSON.stringify({ version: PARSER_VERSION, result }));
  }

  loadManifest(): ResolutionManifest | null {
    const file = path.join(this.directory, "manifest.json");
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(file, "utf8"),
      ) as ResolutionManifest;
      if (parsed.version !== 1 || parsed.parserVersion !== PARSER_VERSION)
        return null;
      return parsed;
    } catch {
      return null;
    }
  }

  saveManifest(manifest: ResolutionManifest): void {
    fs.mkdirSync(this.directory, { recursive: true });
    writeAtomic(
      path.join(this.directory, "manifest.json"),
      JSON.stringify(manifest),
    );
  }

  private parseFile(contentHash: string): string {
    return path.join(
      this.directory,
      "parse",
      contentHash.slice(0, 2),
      `${contentHash}.json`,
    );
  }
}

export function disabledCacheStats(): CacheStats {
  return {
    enabled: false,
    parseHits: 0,
    parseMisses: 0,
    resolutionReused: false,
  };
}

export function hashContent(content: string): string {
  return sha256(`${PARSER_VERSION}\0${content}`);
}

export function hashList(values: string[]): string {
  return sha256(values.join("\0"));
}

function writeAtomic(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, file);
}
