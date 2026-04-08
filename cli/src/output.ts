import { CliError, isCliError } from './errors';

export interface CommandHelp {
  usage: string;
  example: string;
}

export interface OutputOptions {
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export interface OutputWriters {
  writeOut: (chunk: string) => void;
  writeErr: (chunk: string) => void;
}

function toCliError(error: unknown, fallbackHelp?: CommandHelp): CliError {
  if (isCliError(error)) {
    if (!fallbackHelp || (error.usage && error.example)) {
      return error;
    }

    return new CliError(error.message, {
      hint: error.hint,
      usage: error.usage ?? fallbackHelp.usage,
      example: error.example ?? fallbackHelp.example,
      details: error.details,
      exitCode: error.exitCode,
    });
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return new CliError(message, {
    hint: 'Run `leaflet-cli --help` to inspect the available commands.',
    usage: fallbackHelp?.usage,
    example: fallbackHelp?.example,
  });
}

export class Output {
  constructor(
    private readonly options: Required<OutputOptions>,
    private readonly writers: OutputWriters
  ) {}

  info(message: string): void {
    if (!this.options.verbose) return;
    this.writers.writeErr(`${message}\n`);
  }

  debug(title: string, payload: unknown): void {
    if (!this.options.debug) return;

    const content = typeof payload === 'string'
      ? payload
      : JSON.stringify(payload, null, 2);

    this.writers.writeErr(`[debug] ${title}\n${content}\n`);
  }

  success(payload: Record<string, unknown>, humanLines: string[]): void {
    if (this.options.json) {
      this.writers.writeOut(`${JSON.stringify({ success: true, ...payload }, null, 2)}\n`);
      return;
    }

    this.writers.writeOut(`${humanLines.join('\n')}\n`);
  }

  failure(error: unknown, fallbackHelp?: CommandHelp): number {
    const cliError = toCliError(error, fallbackHelp);

    if (this.options.json) {
      this.writers.writeOut(`${JSON.stringify({
        success: false,
        error: cliError.message,
        hint: cliError.hint,
        usage: cliError.usage,
        example: cliError.example,
        details: cliError.details,
      }, null, 2)}\n`);
      return cliError.exitCode;
    }

    const lines = [`Error: ${cliError.message}`];

    if (cliError.details && cliError.details.length > 0) {
      for (const detail of cliError.details) {
        lines.push('', detail);
      }
    }

    if (cliError.usage) {
      lines.push('', 'Usage:', `  ${cliError.usage}`);
    }

    if (cliError.example) {
      lines.push('', 'Example:', `  ${cliError.example}`);
    }

    if (cliError.hint) {
      lines.push('', `Hint: ${cliError.hint}`);
    }

    this.writers.writeErr(`${lines.join('\n')}\n`);
    return cliError.exitCode;
  }
}
