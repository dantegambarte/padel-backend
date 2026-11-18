import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';

import { ErrorReporter } from '../error-reporting/error-reporter';
import { HttpExceptionFilter } from './http-exception.filter';

function hostFor(): { host: ArgumentsHost; json: jest.Mock } {
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const request = { method: 'GET', url: '/api/v1/x', headers: {} };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, json };
}

describe('HttpExceptionFilter error reporting', () => {
  let reporter: ErrorReporter & { report: jest.Mock };
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    reporter = { report: jest.fn() };
    filter = new HttpExceptionFilter(reporter);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports unhandled errors to the error reporter', () => {
    const error = new Error('db down');
    const { host, json } = hostFor();

    filter.catch(error, host);

    expect(reporter.report).toHaveBeenCalledWith(error, { method: 'GET', path: '/api/v1/x' });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });

  it('does not report client errors', () => {
    const { host } = hostFor();

    filter.catch(new BadRequestException('bad'), host);

    expect(reporter.report).not.toHaveBeenCalled();
  });
});
