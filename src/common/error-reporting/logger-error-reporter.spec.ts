import { Logger } from '@nestjs/common';

import { LoggerErrorReporter } from './logger-error-reporter';

describe('LoggerErrorReporter redaction', () => {
  afterEach(() => jest.restoreAllMocks());

  it('redacts the message and context in the log and the webhook body', () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response());

    new LoggerErrorReporter('https://hooks.example.invalid/x').report(
      new Error('failed for a@b.com'),
      { path: '/x', authorization: 'Bearer abc' },
    );

    const logged = JSON.stringify(logError.mock.calls[0]);
    const sent = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    for (const output of [logged, sent]) {
      expect(output).not.toMatch(/a@b\.com|Bearer abc/);
      expect(output).toContain('/x');
    }
  });
});
