import { UnauthorizedException } from '@nestjs/common';
import { TokenExpiredError, JsonWebTokenError } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('retorna el usuario si el token es válido', () => {
    const user = { id: 'user-uuid', role: 'admin' };
    const result = guard.handleRequest(null, user, null);
    expect(result).toBe(user);
  });

  it('lanza UnauthorizedException con mensaje de expiración si el token expiró', () => {
    const expired = new TokenExpiredError('jwt expired', new Date());
    expect(() => guard.handleRequest(null, null, expired)).toThrow(UnauthorizedException);
    expect(() => guard.handleRequest(null, null, expired)).toThrow('expirado');
  });

  it('lanza UnauthorizedException con mensaje de token inválido', () => {
    const invalid = new JsonWebTokenError('invalid signature');
    expect(() => guard.handleRequest(null, null, invalid)).toThrow(UnauthorizedException);
    expect(() => guard.handleRequest(null, null, invalid)).toThrow('inválido');
  });

  it('lanza UnauthorizedException si no hay usuario y no hay info JWT', () => {
    expect(() => guard.handleRequest(null, null, null)).toThrow(UnauthorizedException);
  });

  it('re-lanza el error original si viene un err explícito', () => {
    const err = new UnauthorizedException('custom error');
    expect(() => guard.handleRequest(err, null, null)).toThrow(UnauthorizedException);
  });
});
