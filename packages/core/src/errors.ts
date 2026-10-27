export class ImpactMapError extends Error {
  readonly exitCode: number;
  readonly code: string;

  constructor(message: string, exitCode: number, code: string) {
    super(message);
    this.name = "ImpactMapError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

export function isImpactMapError(error: unknown): error is ImpactMapError {
  return error instanceof ImpactMapError;
}
