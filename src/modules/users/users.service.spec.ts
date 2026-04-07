import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';

const mockUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-uuid',
    username: 'empleado',
    fullName: 'Empleado Test',
    role: UserRole.EMPLOYEE,
    isActive: true,
    mustChangePassword: false,
    passwordHash: 'hashed',
    createdAt: new Date(),
    ...overrides,
  }) as User;

describe('UsersService', () => {
  let service: UsersService;

  const userRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getRepositoryToken(User), useValue: userRepo }],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('retorna lista de usuarios', async () => {
      userRepo.find.mockResolvedValue([mockUser()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('retorna el usuario si existe', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      const result = await service.findOne('user-uuid');
      expect(result.id).toBe('user-uuid');
    });

    it('lanza NotFoundException si no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('crea un usuario nuevo correctamente', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const newUser = mockUser();
      userRepo.create.mockReturnValue(newUser);
      userRepo.save.mockResolvedValue(newUser);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.create({
        username: 'empleado',
        fullName: 'Empleado Test',
        password: 'pass123',
      });

      expect(result).not.toHaveProperty('passwordHash');
    });

    it('lanza ConflictException si el username ya existe', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      await expect(
        service.create({ username: 'empleado', fullName: 'Test', password: 'pass' }),
      ).rejects.toThrow(ConflictException);
    });

    it('asigna rol EMPLOYEE por defecto si no se especifica', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const newUser = mockUser();
      userRepo.create.mockReturnValue(newUser);
      userRepo.save.mockResolvedValue(newUser);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await service.create({ username: 'new', fullName: 'New', password: 'pass' });
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.EMPLOYEE }),
      );
    });
  });

  describe('update', () => {
    it('actualiza los campos permitidos', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue({ ...user, fullName: 'Nuevo Nombre' });

      await service.update('user-uuid', { fullName: 'Nuevo Nombre' }, 'admin-uuid');
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('lanza ForbiddenException si el usuario intenta desactivarse a sí mismo', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ id: 'same-uuid' }));
      await expect(service.update('same-uuid', { isActive: false }, 'same-uuid')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lanza NotFoundException si el usuario no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', {}, 'admin')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resetPassword', () => {
    it('restablece la contraseña y activa mustChangePassword', async () => {
      const user = mockUser({ mustChangePassword: false });
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('new_hashed' as never);

      const result = await service.resetPassword(
        'user-uuid',
        { newPassword: 'NuevaClave123' },
        'admin-uuid',
      );

      expect(result.success).toBe(true);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: true }),
      );
    });

    it('hashea la nueva contraseña antes de persistirla', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);
      const hashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed_new' as never);

      await service.resetPassword('user-uuid', { newPassword: 'plain' }, 'admin-uuid');

      expect(hashSpy).toHaveBeenCalledWith('plain', expect.any(Number));
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'hashed_new' }),
      );
    });

    it('lanza ForbiddenException si el admin intenta resetear su propia contraseña', async () => {
      await expect(
        service.resetPassword('admin-uuid', { newPassword: 'nueva' }, 'admin-uuid'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si el usuario objetivo no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.resetPassword('missing-uuid', { newPassword: 'nueva' }, 'admin-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('retorna mensaje de confirmación', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      userRepo.save.mockResolvedValue(mockUser());
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.resetPassword(
        'user-uuid',
        { newPassword: 'pass' },
        'admin-uuid',
      );

      expect(result).toEqual({ success: true, message: expect.any(String) });
    });
  });

  describe('deactivate', () => {
    it('desactiva al usuario correctamente', async () => {
      const user = mockUser({ role: UserRole.EMPLOYEE });
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue({ ...user, isActive: false });

      await service.deactivate('user-uuid', 'admin-uuid');
      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });

    it('lanza ForbiddenException si intenta desactivarse a sí mismo', async () => {
      await expect(service.deactivate('same-uuid', 'same-uuid')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lanza ForbiddenException si es el último administrador activo', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ id: 'admin-uuid', role: UserRole.ADMIN }));
      userRepo.count.mockResolvedValue(1);
      await expect(service.deactivate('admin-uuid', 'other-uuid')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('permite desactivar a un admin si hay más de uno activo', async () => {
      const adminUser = mockUser({ id: 'admin-uuid', role: UserRole.ADMIN });
      userRepo.findOne.mockResolvedValue(adminUser);
      userRepo.count.mockResolvedValue(2);
      userRepo.save.mockResolvedValue({ ...adminUser, isActive: false });

      await service.deactivate('admin-uuid', 'other-admin-uuid');
      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });

    it('lanza NotFoundException si el usuario no existe', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.deactivate('missing', 'admin')).rejects.toThrow(NotFoundException);
    });
  });
});
