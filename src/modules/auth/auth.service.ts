import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Valida credenciales. Retorna el usuario sin passwordHash,
   * o lanza UnauthorizedException.
   *
   * Usamos un mensaje genérico intencionalmente para no revelar
   * si el usuario existe o si la contraseña es incorrecta.
   */
  async validateUser(username: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { username: username.toLowerCase().trim() },
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'passwordHash'],
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

  /**
   * Genera el par de tokens (access + refresh) tras un login exitoso.
   */
  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const [accessToken, refreshToken] = await this.signTokenPair(payload);

    this.logger.log(`Login exitoso: ${user.username} (${user.role})`);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  /**
   * Firma un par access + refresh token para el payload dado.
   * Centraliza la lógica de firma para reutilizarla en login y refresh.
   */
  private async signTokenPair(payload: JwtPayload): Promise<[string, string]> {
    return Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '8h'),
        algorithm: 'HS256',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
        algorithm: 'HS256',
      }),
    ]);
  }

  /**
   * Renueva el par de tokens usando el refresh token actual (rotación).
   * Emite un nuevo accessToken Y un nuevo refreshToken, descartando el anterior.
   * El Angular debe almacenar ambos tokens retornados en cada llamada.
   */
  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });

      // Verificamos que el usuario siga activo al momento del refresh
      const user = await this.userRepo.findOne({
        where: { id: payload.sub },
        select: ['id', 'username', 'fullName', 'role', 'isActive'],
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Sesión inválida.');
      }

      const newPayload: JwtPayload = {
        sub: user.id,
        username: user.username,
        role: user.role,
      };

      // Rotación: se emite un nuevo par completo. El refresh token anterior
      // queda huérfano y el cliente debe reemplazarlo.
      const [newAccessToken, newRefreshToken] = await this.signTokenPair(newPayload);

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch {
      throw new UnauthorizedException(
        'Refresh token inválido o expirado. Iniciá sesión nuevamente.',
      );
    }
  }

  /**
   * Retorna el perfil del usuario autenticado (sin datos sensibles).
   */
  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'createdAt'],
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    return user;
  }
}
