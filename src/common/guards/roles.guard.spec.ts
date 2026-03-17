import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../modules/users/entities/user.entity';

const mockContext = (user: any, handler: Function = () => {}, cls: Function = () => {}) => ({
  switchToHttp: () => ({
    getRequest: () => ({ user }),
  }),
  getHandler: () => handler,
  getClass: () => cls,
});

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('permite el acceso si no se definieron roles (@Roles ausente)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    const ctx = mockContext({ role: UserRole.EMPLOYEE }) as any;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('permite el acceso si el usuario tiene el rol requerido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = mockContext({ role: UserRole.ADMIN }) as any;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lanza ForbiddenException si el usuario no tiene el rol requerido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = mockContext({ role: UserRole.EMPLOYEE }) as any;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('permite el acceso si el usuario es ADMIN en un endpoint multi-rol', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN, UserRole.EMPLOYEE]);
    const ctx = mockContext({ role: UserRole.ADMIN }) as any;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
