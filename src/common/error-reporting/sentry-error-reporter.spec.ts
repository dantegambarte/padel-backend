import { createErrorReporter } from './error-reporting.module';
import { LoggerErrorReporter } from './logger-error-reporter';
import { scrubSentryEvent, SentryErrorReporter } from './sentry-error-reporter';
import { requestContext } from '../logging/request-context';

describe('Sentry error reporter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is not used without SENTRY_DSN', () => {
    expect(createErrorReporter({})).toBeInstanceOf(LoggerErrorReporter);
  });

  it('initialises Sentry without collecting PII when SENTRY_DSN is set', () => {
    const init = jest.fn();
    const reporter = createErrorReporter(
      {
        SENTRY_DSN: 'https://key@example.invalid/1',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_RELEASE: 'v1',
      },
      { init, captureException: jest.fn() },
    );
    expect(reporter).toBeInstanceOf(SentryErrorReporter);
    const opts = init.mock.calls[0][0];
    expect(opts).toMatchObject({
      dsn: 'https://key@example.invalid/1',
      environment: 'staging',
      release: 'v1',
      dataCollection: expect.objectContaining({ userInfo: false, cookies: false, httpBodies: [] }),
    });
    expect(opts.beforeSend).toBe(scrubSentryEvent);
  });

  it('captures with redacted context and the request id, and still logs', () => {
    const captureException = jest.fn();
    const log = jest.spyOn(LoggerErrorReporter.prototype, 'report').mockImplementation(() => {});
    const reporter = new SentryErrorReporter(
      { init: jest.fn(), captureException },
      new LoggerErrorReporter(undefined),
    );
    const err = new Error('boom');
    requestContext.run({ requestId: 'req-2' }, () => reporter.report(err, { email: 'a@b.com' }));
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { requestId: 'req-2' },
      extra: { email: '[REDACTED]' },
    });
    expect(log).toHaveBeenCalled();
  });

  it('beforeSend scrubs request data, user and messages', () => {
    const event = scrubSentryEvent({
      message: 'for a@b.com',
      user: { email: 'a@b.com', ip_address: '1.2.3.4' },
      request: {
        headers: { authorization: 'Bearer x', cookie: 'c' },
        cookies: { a: 'b' },
        data: { password: 'secretpw' },
      },
      exception: { values: [{ value: 'phone +54 9 11 1234-5678' }] },
    });
    expect(JSON.stringify(event)).not.toMatch(/a@b\.com|Bearer x|1234-5678|secretpw|1\.2\.3\.4/);
  });
});
