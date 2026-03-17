import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User, UserRole } from '../users/entities/user.entity';

const mockUser = (): Partial<User> => ({
  id: 'user-uuid',
  username: 'admin',
  fullName: 'Admin Test',
  role: UserRole.ADMIN,
  isActive: true,
  mustChangePassword: false,
  passwordHash: 'hashed_password',
});

describe('AuthService', () => {
  let service: AuthService;

  const userRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
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
  });

  describe('validateUser', () => {
    it('lanza UnauthorizedException si el usuario no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.validateUser('nobody', 'pass')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser(), isActive: false });
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
      userRepo.findOne.mockResolvedValue({ ...mockUser(), mustChangePassword: true });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login({ username: 'admin', password: 'pass' });
      expect(result.user.mustChangePassword).toBe(true);
    });
  });

  describe('refreshToken', () => {
    it('retorna nuevo par de tokens si el refresh token es válido', async () => {
      const user = mockUser();
      jwtService.verifyAsync.mockResolvedValue({ sub: user.id, username: user.username, role: user.role });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.refreshToken('valid_refresh');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('lanza UnauthorizedException si el token es inválido', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
      await expect(service.refreshToken('bad_token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'uid', username: 'x', role: 'admin' });
      userRepo.findOne.mockResolvedValue({ ...mockUser(), isActive: false });
      await expect(service.refreshToken('token')).rejects.toThrow(UnauthorizedException);
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
      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: false }));
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
