import { getRequestId, requestIdMiddleware, resolveRequestId } from './request-context';

describe('request id', () => {
  it('accepts a safe incoming id and rejects unsafe ones', () => {
    expect(resolveRequestId('abc-123_DEF.9')).toBe('abc-123_DEF.9');
    for (const bad of ['', 'a b', 'x'.repeat(129), 'a\nb', '<script>', undefined]) {
      expect(resolveRequestId(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(resolveRequestId(['id-1', 'id-2'])).toBe('id-1');
  });

  it('sets the response header and exposes the id during the request', () => {
    const setHeader = jest.fn();
    let seen: string | undefined;
    requestIdMiddleware(
      { headers: { 'x-request-id': 'req-1' } } as never,
      { setHeader } as never,
      () => {
        seen = getRequestId();
      },
    );
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-1');
    expect(seen).toBe('req-1');
    expect(getRequestId()).toBeUndefined();
  });
});
