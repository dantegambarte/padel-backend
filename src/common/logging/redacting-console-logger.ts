import { ConsoleLogger, LogLevel } from '@nestjs/common';

import { redact } from './redact';
import { getRequestId } from './request-context';

type JsonLogOptions = {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
};

/** App logger: every message and stack goes through redact(); JSON lines carry the request id. */
export class RedactingConsoleLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    const requestId = getRequestId();
    const ctx = requestId && !this.options.json && context ? `${context} ${requestId}` : context;
    super.printMessages(
      messages.map((message) => redact(message)),
      ctx,
      logLevel,
      writeStreamType,
      redact(errorStack),
    );
  }

  protected getJsonLogObject(message: unknown, options: JsonLogOptions) {
    const requestId = getRequestId();
    const logObject = super.getJsonLogObject(message, options);
    return requestId ? { ...logObject, requestId } : logObject;
  }
}
