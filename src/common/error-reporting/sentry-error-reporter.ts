import type { ErrorEvent, NodeOptions } from '@sentry/node';

import { redact } from '../logging/redact';
import { getRequestId } from '../logging/request-context';
import { ErrorContext, ErrorReporter } from './error-reporter';

/** The subset of the Sentry SDK used here (injectable for tests). */
export interface SentryClient {
  init(options: NodeOptions): unknown;
  captureException(
    error: unknown,
    hint?: { tags?: Record<string, string>; extra?: ErrorContext },
  ): unknown;
}

/** beforeSend hook: drops user/IP and cookies, then redacts everything else. */
export function scrubSentryEvent<T extends Partial<ErrorEvent>>(event: T): T {
  const scrubbed = redact(event) as T;
  delete scrubbed.user;
  if (scrubbed.request) {
    delete scrubbed.request.cookies;
    delete scrubbed.request.data;
  }
  return scrubbed;
}

export function sentryOptions(env: NodeJS.ProcessEnv): NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    release: env.SENTRY_RELEASE || undefined,
    // SDK v11 replaced sendDefaultPii with dataCollection: collect no user info, cookies,
    // headers, bodies or query strings (the equivalent of sendDefaultPii: false, but stricter).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend: scrubSentryEvent,
  };
}

/** Sends errors to Sentry (redacted, tagged with the request id) and still logs them locally. */
export class SentryErrorReporter extends ErrorReporter {
  constructor(
    private readonly sentry: SentryClient,
    private readonly fallback: ErrorReporter,
  ) {
    super();
  }

  report(error: unknown, context: ErrorContext = {}): void {
    this.fallback.report(error, context);
    const requestId = getRequestId();
    this.sentry.captureException(error, {
      ...(requestId ? { tags: { requestId } } : {}),
      extra: redact(context) as ErrorContext,
    });
  }
}
