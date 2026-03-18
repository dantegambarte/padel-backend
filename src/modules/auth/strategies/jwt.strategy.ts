import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  /** Versión de sesión al momento de emitir el token. */
  sv: number;
}

/**
 * Estrategia JWT de Passport. Valida el token y carga el usuario desde la DB
 * para verificar que sigue activo en cada request protegido.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Valida el token JWT:
   * 1. Verifica que el usuario exista y esté activo.
   * 2. Compara `sv` (session version) del token con el valor en DB.
   *    Si no coincide → alguien inició sesión desde otro dispositivo.
   */
  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: ['id', 'username', 'fullName', 'role', 'isActive', 'sessionVersion'],
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Usuario inactivo o no encontrado. Contacte al administrador.',
      );
    }

    if (payload.sv !== user.sessionVersion) {
      throw new UnauthorizedException(
        JSON.stringify({
          error: 'SESSION_OVERRIDDEN',
          message: 'Sesión iniciada en otro dispositivo.',
        }),
      );
    }

    return user;
  }
}
