import { Injectable, Logger } from '@nestjs/common';

import { redact, redactString } from '../logging/redact';
import { ErrorContext, ErrorReporter } from './error-reporter';

/**
 * Default reporter: writes the error through the app logger (JSON in production)
 * and, when ERROR_WEBHOOK_URL is set, POSTs a short JSON alert to it.
 * Without the env var no data leaves the process.
 */
@Injectable()
export class LoggerErrorReporter extends ErrorReporter {
  private readonly logger = new Logger('ErrorReporter');

  constructor(private readonly webhookUrl: string | undefined = process.env.ERROR_WEBHOOK_URL) {
    super();
  }

  report(error: unknown, rawContext: ErrorContext = {}): void {
    const context = redact(rawContext) as ErrorContext;
    const message = redactString(error instanceof Error ? error.message : String(error));
    const stack = error instanceof Error && error.stack ? redactString(error.stack) : undefined;
    this.logger.error({ msg: 'Unhandled error', error: message, ...context }, stack);

    if (!this.webhookUrl) return;
    fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[padel-backend] ${message}`, error: message, ...context }),
      signal: AbortSignal.timeout(5000),
    }).catch((err: unknown) => {
      this.logger.warn(`Error webhook failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
