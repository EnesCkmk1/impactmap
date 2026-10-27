import { pythonParser } from "./python.js";
import {
  type LanguageParser,
  languageForPath,
  type ParseInput,
  type ParseResult,
} from "./types.js";
import { typescriptParser } from "./typescript.js";

export function builtinParsers(): LanguageParser[] {
  return [typescriptParser, pythonParser];
}

export function parserFor(
  filePath: string,
  parsers: readonly LanguageParser[] = builtinParsers(),
): LanguageParser | undefined {
  return parsers.find((parser) => parser.supports(filePath));
}

export function parseSource(
  input: ParseInput,
  parsers: readonly LanguageParser[] = builtinParsers(),
): ParseResult {
  const parser = parserFor(input.path, parsers);
  if (!parser) {
    return {
      language: languageForPath(input.path),
      status: "unsupported",
      imports: [],
      exports: [],
      diagnostics: [
        {
          severity: "info",
          code: "unsupported-language",
          message: `No parser is registered for ${input.path}.`,
        },
      ],
    };
  }
  return parser.parse(input);
}
