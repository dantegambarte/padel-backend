import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User, UserRole } from '../users/entities/user.entity';

const mockUser = (overrides: Partial<User> = {}): Partial<User> => ({
  id: 'user-uuid',
  username: 'admin',
  fullName: 'Admin Test',
  role: UserRole.ADMIN,
  isActive: true,
  mustChangePassword: false,
  passwordHash: 'hashed_password',
  sessionVersion: 3,
  refreshTokenVersion: 4,
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;

  const userRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    increment: jest.fn(),
    update: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed_token'),
    verifyAsync: jest.fn(),
  };

  const configService = {
    get: jest.fn().mockReturnValue('test_secret'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue('signed_token');
    configService.get.mockReturnValue('test_secret');
    userRepo.increment.mockResolvedValue({});
    userRepo.update.mockResolvedValue({});
  });

  describe('validateUser', () => {
    it('lanza UnauthorizedException si el usuario no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.validateUser('nobody', 'pass')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ isActive: false }));
      await expect(service.validateUser('admin', 'pass')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si la contraseña es incorrecta', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      await expect(service.validateUser('admin', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('retorna el usuario si las credenciales son válidas', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      const user = await service.validateUser('admin', 'correct');
      expect(user.username).toBe('admin');
    });

    it('normaliza el username a minúsculas y sin espacios', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await service.validateUser('  ADMIN  ', 'pass').catch(() => {});
      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: 'admin' } }),
      );
    });
  });

  describe('login', () => {
    it('retorna accessToken, refreshToken y datos del usuario', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login({ username: 'admin', password: 'pass' });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.username).toBe('admin');
    });

    it('incluye mustChangePassword en la respuesta', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ mustChangePassword: true }));
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login({ username: 'admin', password: 'pass' });
      expect(result.user.mustChangePassword).toBe(true);
    });

    it('incluye mustChangePassword: false cuando no está activo el flag', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ mustChangePassword: false }));
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login({ username: 'admin', password: 'pass' });
      expect(result.user.mustChangePassword).toBe(false);
    });

    it('incrementa sessionVersion en cada login, también con NODE_ENV=test', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ sessionVersion: 2 }));
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.login({ username: 'admin', password: 'pass' });

      expect(process.env.NODE_ENV).toBe('test');
      expect(userRepo.update).toHaveBeenCalledWith('user-uuid', { sessionVersion: 3 });
    });

    it('firma los tokens con la nueva sv y la rv vigente', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ sessionVersion: 5, refreshTokenVersion: 9 }));
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.login({ username: 'admin', password: 'pass' });

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-uuid', sv: 6, rv: 9 }),
        expect.any(Object),
      );
    });
  });

  describe('refreshToken', () => {
    const tokenFor = (user: Partial<User>, overrides: Record<string, unknown> = {}) => ({
      sub: user.id,
      username: user.username,
      role: user.role,
      sv: user.sessionVersion,
      rv: user.refreshTokenVersion,
      ...overrides,
    });

    it('rota el refresh token: incrementa rv con un UPDATE condicional y firma el par nuevo', async () => {
      const user = mockUser();
      jwtService.verifyAsync.mockResolvedValue(tokenFor(user));
      userRepo.findOne.mockResolvedValue(user);
      userRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.refreshToken('valid_refresh');

      expect(result).toEqual({ accessToken: 'signed_token', refreshToken: 'signed_token' });
      expect(userRepo.update).toHaveBeenCalledWith(
        { id: 'user-uuid', sessionVersion: 3, refreshTokenVersion: 4 },
        { refreshTokenVersion: 5 },
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sv: 3, rv: 5 }),
        expect.any(Object),
      );
      expect(userRepo.increment).not.toHaveBeenCalled();
    });

    it('detecta el reuso de un refresh token ya rotado y revoca la sesión', async () => {
      const user = mockUser();
      jwtService.verifyAsync.mockResolvedValue(tokenFor(user, { rv: 3 }));
      userRepo.findOne.mockResolvedValue(user);
      userRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.refreshToken('reused')).rejects.toThrow(UnauthorizedException);
      expect(userRepo.increment).toHaveBeenCalledWith({ id: 'user-uuid' }, 'sessionVersion', 1);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rechaza un refresh token de una sesión anterior (después de login o logout)', async () => {
      const user = mockUser({ sessionVersion: 7 });
      jwtService.verifyAsync.mockResolvedValue(tokenFor(user, { sv: 5 }));
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.refreshToken('old_session')).rejects.toThrow(UnauthorizedException);
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rechaza un refresh token emitido antes de la rotación (sin rv)', async () => {
      const user = mockUser();
      jwtService.verifyAsync.mockResolvedValue(tokenFor(user, { rv: undefined }));
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.refreshToken('legacy')).rejects.toThrow(UnauthorizedException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('lanza UnauthorizedException si el token es inválido', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
      await expect(service.refreshToken('bad_token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      const user = mockUser({ isActive: false });
      jwtService.verifyAsync.mockResolvedValue(tokenFor(user));
      userRepo.findOne.mockResolvedValue(user);
      await expect(service.refreshToken('token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el usuario no existe en DB', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'uid', sv: 1, rv: 0 });
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.refreshToken('token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('incrementa sessionVersion para invalidar los tokens de la sesión', async () => {
      await service.logout('user-uuid');
      expect(userRepo.increment).toHaveBeenCalledWith({ id: 'user-uuid' }, 'sessionVersion', 1);
    });
  });

  describe('getProfile', () => {
    it('retorna el usuario autenticado', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      const result = await service.getProfile('user-uuid');
      expect(result.id).toBe('user-uuid');
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getProfile('missing-uuid')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changeOwnPassword', () => {
    it('actualiza la contraseña si la actual es correcta y la nueva es diferente', async () => {
      const user = { ...mockUser(), passwordHash: await bcrypt.hash('current', 10) };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('new_hash' as never);

      const result = await service.changeOwnPassword('user-uuid', {
        currentPassword: 'current',
        newPassword: 'newpass123',
      });

      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: false }),
      );
    });

    it('limpia el flag mustChangePassword al cambiar la contraseña', async () => {
      const user = { ...mockUser({ mustChangePassword: true }) };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('new_hash' as never);

      await service.changeOwnPassword('user-uuid', {
        currentPassword: 'current',
        newPassword: 'newpass123',
      });

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: false }),
      );
    });

    it('retorna mensaje de confirmación', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      userRepo.save.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('new_hash' as never);

      const result = await service.changeOwnPassword('user-uuid', {
        currentPassword: 'current',
        newPassword: 'diferente123',
      });

      expect(result).toEqual({ success: true, message: expect.any(String) });
    });

    it('lanza BadRequestException si la contraseña actual es incorrecta', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.changeOwnPassword('user-uuid', { currentPassword: 'wrong', newPassword: 'new' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si la nueva contraseña es igual a la actual', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.changeOwnPassword('user-uuid', { currentPassword: 'same', newPassword: 'same' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.changeOwnPassword('missing', { currentPassword: 'a', newPassword: 'b' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
