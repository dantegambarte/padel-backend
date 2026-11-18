export interface ErrorContext {
  [key: string]: unknown;
}

/**
 * Pluggable sink for unhandled errors. Bind a different implementation
 * (e.g. Sentry) in ErrorReportingModule to send errors to an external service.
 */
export abstract class ErrorReporter {
  abstract report(error: unknown, context?: ErrorContext): void;
}
