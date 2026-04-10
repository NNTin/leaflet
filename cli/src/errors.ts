export interface CliErrorOptions {
  hint?: string;
  usage?: string;
  example?: string;
  details?: string[];
  exitCode?: number;
}

export class CliError extends Error {
  readonly hint?: string;
  readonly usage?: string;
  readonly example?: string;
  readonly details?: string[];
  readonly exitCode: number;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.hint = options.hint;
    this.usage = options.usage;
    this.example = options.example;
    this.details = options.details;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}
