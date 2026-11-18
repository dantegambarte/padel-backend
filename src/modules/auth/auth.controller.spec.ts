import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthController, REFRESH_COOKIE_NAME } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController (refresh cookie)', () => {
  let authService: { login: jest.Mock; refreshToken: jest.Mock; logout: jest.Mock };
  let env: Record<string, string>;
  let controller: AuthController;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  const configService = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;

  beforeEach(() => {
    env = { NODE_ENV: 'test', JWT_REFRESH_EXPIRES_IN: '7d' };
    authService = {
      login: jest.fn().mockResolvedValue({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: { id: 'u1' },
      }),
      refreshToken: jest.fn().mockResolvedValue({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(authService as unknown as AuthService, configService);
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
  });

  const asRes = () => res as unknown as Response;
  const reqWith = (cookies?: Record<string, string>) => ({ cookies }) as unknown as Request;

  it('login sets the HttpOnly cookie and drops refreshToken from the body', async () => {
    const body = await controller.login({ username: 'a', password: 'b' }, asRes());

    expect(body).toEqual({ accessToken: 'access-1', user: { id: 'u1' } });
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'refresh-1', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('marks the cookie Secure in production', async () => {
    env.NODE_ENV = 'production';
    await controller.login({ username: 'a', password: 'b' }, asRes());
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'refresh-1',
      expect.objectContaining({ secure: true }),
    );
  });

  it('refresh prefers the cookie over the transitional body field', async () => {
    const body = await controller.refresh(
      reqWith({ [REFRESH_COOKIE_NAME]: 'from-cookie' }),
      { refreshToken: 'from-body' },
      asRes(),
    );

    expect(authService.refreshToken).toHaveBeenCalledWith('from-cookie');
    expect(body).toEqual({ accessToken: 'access-2' });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'refresh-2',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('refresh falls back to the body field when there is no cookie', async () => {
    await controller.refresh(reqWith(), { refreshToken: 'from-body' }, asRes());
    expect(authService.refreshToken).toHaveBeenCalledWith('from-body');
  });

  it('refresh without cookie and body is 401 and never reaches the service', async () => {
    await expect(controller.refresh(reqWith({}), {}, asRes())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('logout clears the cookie with the same path and flags', async () => {
    await controller.logout('u1', asRes());
    expect(authService.logout).toHaveBeenCalledWith('u1');
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  });
});
