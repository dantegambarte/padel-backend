import { redact, redactString } from './redact';

describe('redact', () => {
  it('masks sensitive keys at any depth, case-insensitively', () => {
    const out = redact({
      password: 'p',
      Authorization: 'Bearer abc',
      headers: { cookie: 'refresh_token=x', 'x-ok': 'fine' },
      refresh_token: 'r',
      accessToken: 'a',
      phoneNumber: '+5491100000000',
      email: 'a@b.com',
      nested: [{ newPassword: 'n' }],
      bookingId: 'b1',
    });
    expect(out).toEqual({
      password: '[REDACTED]',
      Authorization: '[REDACTED]',
      headers: { cookie: '[REDACTED]', 'x-ok': 'fine' },
      refresh_token: '[REDACTED]',
      accessToken: '[REDACTED]',
      phoneNumber: '[REDACTED]',
      email: '[REDACTED]',
      nested: [{ newPassword: '[REDACTED]' }],
      bookingId: 'b1',
    });
  });

  it('masks emails, bearer tokens, JWTs and phone numbers inside strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl';
    const s = redactString(
      `user a.b@x.com sent Bearer abc.def ${jwt} from +54 9 11 1234-5678 booking 42`,
    );
    expect(s).not.toMatch(/a\.b@x\.com|abc\.def|eyJ|1234-5678/);
    expect(s).toContain('booking 42');
  });

  it('keeps UUIDs and ISO dates intact', () => {
    const id = '0b6f1c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
    expect(redactString(`id ${id} at 2026-11-17T10:00:00.000Z`)).toBe(
      `id ${id} at 2026-11-17T10:00:00.000Z`,
    );
  });

  it('redacts Error messages without mutating the input and survives cycles', () => {
    const input: Record<string, unknown> = { password: 'x' };
    input.self = input;
    const out = redact(input) as Record<string, unknown>;
    expect(input.password).toBe('x');
    expect(out.password).toBe('[REDACTED]');
    const err = redact(new Error('mail a@b.com')) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain('a@b.com');
  });
});
