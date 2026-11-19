import { Global, Module } from '@nestjs/common';

import { ErrorReporter } from './error-reporter';
import { LoggerErrorReporter } from './logger-error-reporter';
import { SentryClient, SentryErrorReporter, sentryOptions } from './sentry-error-reporter';

/** Sentry is used only when SENTRY_DSN is set; otherwise errors are logged (and optionally webhooked). */
export function createErrorReporter(env: NodeJS.ProcessEnv, sentry?: SentryClient): ErrorReporter {
  const logger = new LoggerErrorReporter(env.ERROR_WEBHOOK_URL);
  if (!env.SENTRY_DSN) return logger;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const client = sentry ?? (require('@sentry/node') as SentryClient);
  client.init(sentryOptions(env));
  return new SentryErrorReporter(client, logger);
}

@Global()
@Module({
  providers: [{ provide: ErrorReporter, useFactory: () => createErrorReporter(process.env) }],
  exports: [ErrorReporter],
})
export class ErrorReportingModule {}
