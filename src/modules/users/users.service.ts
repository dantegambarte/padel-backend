import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Retorna todos los usuarios sin passwordHash. */
  async findAll(): Promise<Omit<User, 'passwordHash'>[]> {
    return this.userRepo.find({
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Retorna un usuario por ID sin passwordHash. */
  async findOne(id: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.userRepo.findOne({
      where: { id },
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'createdAt'],
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    return user;
  }

  /** Crea un usuario con contraseña hasheada y valida unicidad del username. */
  async create(dto: CreateUserDto): Promise<Omit<User, 'passwordHash'>> {
    const existing = await this.userRepo.findOne({
      where: { username: dto.username.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictException(`El nombre de usuario "${dto.username}" ya está en uso.`);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = this.userRepo.create({
      username: dto.username.toLowerCase().trim(),
      fullName: dto.fullName.trim(),
      passwordHash,
      role: dto.role ?? UserRole.EMPLOYEE,
      isActive: true,
    });

    const saved = await this.userRepo.save(user);
    this.logger.log(`Usuario creado: ${saved.username} (${saved.role})`);

    const { passwordHash: _, ...result } = saved;
    return result;
  }

  /** Actualiza parcialmente un usuario. No permite que el usuario se desactive a sí mismo. */
  async update(
    id: string,
    dto: UpdateUserDto,
    requestingUserId: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    if (dto.isActive === false && id === requestingUserId) {
      throw new ForbiddenException('No podés desactivar tu propia cuenta.');
    }

    if (dto.fullName) {
      user.fullName = dto.fullName.trim();
    }

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
      this.logger.log(`Usuario ${user.username} ${dto.isActive ? 'activado' : 'desactivado'}`);
    }

    if (dto.role !== undefined) {
      user.role = dto.role;
    }

    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...result } = saved;
    return result;
  }

  /**
   * Restablece la contraseña de un usuario por parte del Administrador.
   * La nueva contraseña se hashea con bcrypt antes de persistirse.
   * Nunca devuelve ni registra en logs el valor en texto plano.
   */
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    requestingUserId: string,
  ): Promise<{ success: true; message: string }> {
    if (id === requestingUserId) {
      throw new ForbiddenException('Usá el perfil de tu cuenta para cambiar tu propia contraseña.');
    }

    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = true;
    await this.userRepo.save(user);

    this.logger.log(
      `Contraseña restablecida para "${user.username}" por admin ${requestingUserId}`,
    );

    return { success: true, message: 'Contraseña actualizada' };
  }

  /** Desactiva un usuario (baja lógica). Protege al último administrador del sistema. */
  async deactivate(id: string, requestingUserId: string): Promise<void> {
    if (id === requestingUserId) {
      throw new ForbiddenException('No podés desactivar tu propia cuenta.');
    }

    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.userRepo.count({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException('No podés desactivar al único administrador del sistema.');
      }
    }

    user.isActive = false;
    await this.userRepo.save(user);
    this.logger.log(`Usuario desactivado: ${user.username}`);
  }
}
