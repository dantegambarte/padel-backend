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

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(): Promise<Omit<User, 'passwordHash'>[]> {
    return this.userRepo.find({
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

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

  async create(dto: CreateUserDto): Promise<Omit<User, 'passwordHash'>> {
    // Verificar username único
    const existing = await this.userRepo.findOne({
      where: { username: dto.username.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictException(
        `El nombre de usuario "${dto.username}" ya está en uso.`,
      );
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

    // Retornar sin passwordHash
    const { passwordHash: _, ...result } = saved;
    return result as Omit<User, 'passwordHash'>;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    requestingUserId: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    // No se puede desactivar al propio usuario
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
      this.logger.log(
        `Usuario ${user.username} ${dto.isActive ? 'activado' : 'desactivado'}`,
      );
    }

    if (dto.role !== undefined) {
      user.role = dto.role;
    }

    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...result } = saved;
    return result as Omit<User, 'passwordHash'>;
  }

  /**
   * No eliminamos usuarios físicamente para mantener la auditoría.
   * En cambio, los desactivamos.
   */
  async deactivate(id: string, requestingUserId: string): Promise<void> {
    if (id === requestingUserId) {
      throw new ForbiddenException('No podés desactivar tu propia cuenta.');
    }

    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    // El admin principal (primer admin) no puede ser desactivado
    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.userRepo.count({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException(
          'No podés desactivar al único administrador del sistema.',
        );
      }
    }

    user.isActive = false;
    await this.userRepo.save(user);
    this.logger.log(`Usuario desactivado: ${user.username}`);
  }
}
