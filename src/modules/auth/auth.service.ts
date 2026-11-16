import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import type { StringValue } from 'ms';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Valida credenciales y retorna el usuario sin passwordHash, o lanza UnauthorizedException. */
  async validateUser(username: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { username: username.toLowerCase().trim() },
      select: [
        'id',
        'username',
        'fullName',
        'role',
        'isActive',
        'mustChangePassword',
        'passwordHash',
        'sessionVersion',
        'refreshTokenVersion',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Tu cuenta está desactivada. Contactá al administrador.');
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return user;
  }

  /** Genera el par de tokens (access + refresh) tras un login exitoso. */
  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);

    // Cada login abre una sesión nueva e invalida los tokens de la anterior.
    const newSv = user.sessionVersion + 1;
    await this.userRepo.update(user.id, { sessionVersion: newSv });

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      sv: newSv,
      rv: user.refreshTokenVersion,
    };

    const [accessToken, refreshToken] = await this.signTokenPair(payload);

    this.logger.log(`Login exitoso: ${user.username} (${user.role}) — sessionVersion=${newSv}`);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /** Firma un par access + refresh token para el payload dado. */
  private async signTokenPair(payload: JwtPayload): Promise<[string, string]> {
    return Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '8h') as StringValue,
        algorithm: 'HS256',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') as StringValue,
        algorithm: 'HS256',
      }),
    ]);
  }

  /**
   * Renueva el par de tokens usando el refresh token, con rotación:
   * - El token tiene que pertenecer a la sesión vigente (`sv`).
   * - Cada refresh incrementa `refreshTokenVersion`, así el token usado deja de servir.
   * - Presentar un refresh token ya rotado es un reuso (token robado o copiado):
   *   se revoca la sesión entera incrementando `sessionVersion`.
   */
  async refreshToken(refreshToken: string) {
    const invalid = () =>
      new UnauthorizedException('Refresh token inválido o expirado. Iniciá sesión nuevamente.');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw invalid();
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: [
        'id',
        'username',
        'fullName',
        'role',
        'isActive',
        'sessionVersion',
        'refreshTokenVersion',
      ],
    });

    if (!user || !user.isActive || payload.sv !== user.sessionVersion || payload.rv === undefined) {
      throw invalid();
    }

    // UPDATE condicional y atómico: sólo un refresh concurrente con este token gana.
    const nextRv = payload.rv + 1;
    const rotated = await this.userRepo.update(
      { id: user.id, sessionVersion: payload.sv, refreshTokenVersion: payload.rv },
      { refreshTokenVersion: nextRv },
    );

    if (!rotated.affected) {
      await this.userRepo.increment({ id: user.id }, 'sessionVersion', 1);
      this.logger.warn(`Reuso de refresh token detectado: ${user.username}. Sesión revocada.`);
      throw invalid();
    }

    const [accessToken, newRefreshToken] = await this.signTokenPair({
      sub: user.id,
      username: user.username,
      role: user.role,
      sv: user.sessionVersion,
      rv: nextRv,
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Cierra la sesión en el servidor: incrementa `sessionVersion`, lo que invalida
   * en el acto el access token y el refresh token de la sesión actual.
   */
  async logout(userId: string): Promise<void> {
    await this.userRepo.increment({ id: userId }, 'sessionVersion', 1);
  }

  /** Retorna el perfil del usuario autenticado sin datos sensibles. */
  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'mustChangePassword', 'createdAt'],
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    return user;
  }

  /**
   * Cambia la contraseña del usuario autenticado.
   * Verifica la contraseña actual antes de aplicar el cambio.
   * Limpia el flag `mustChangePassword` al finalizar.
   */
  async changeOwnPassword(
    userId: string,
    dto: ChangeOwnPasswordDto,
  ): Promise<{ success: true; message: string }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'username', 'passwordHash', 'mustChangePassword'],
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    const passwordMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordMatch) {
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual.');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    await this.userRepo.save(user);

    this.logger.log(`Contraseña cambiada por el propio usuario: ${user.username}`);

    return { success: true, message: 'Contraseña actualizada correctamente.' };
  }
}
