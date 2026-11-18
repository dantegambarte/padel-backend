import { RedactingConsoleLogger } from './redacting-console-logger';
import { requestContext } from './request-context';

describe('RedactingConsoleLogger', () => {
  let out: jest.SpyInstance;
  beforeEach(() => {
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('redacts messages and adds the request id to JSON logs', () => {
    const logger = new RedactingConsoleLogger({ json: true });
    requestContext.run({ requestId: 'req-9' }, () =>
      logger.log({ msg: 'login', email: 'a@b.com' }, 'Auth'),
    );
    const line = JSON.parse(String(out.mock.calls[0][0]));
    expect(line.requestId).toBe('req-9');
    expect(line.message).toEqual({ msg: 'login', email: '[REDACTED]' });
    expect(line.context).toBe('Auth');
  });

  it('redacts PII inside plain string messages', () => {
    const logger = new RedactingConsoleLogger({ json: true });
    logger.log('sent to a@b.com');
    expect(String(out.mock.calls[0][0])).not.toContain('a@b.com');
  });
});
