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

  /** Retorna el usuario autenticado o lanza UnauthorizedException si está inactivo. */
  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: ['id', 'username', 'fullName', 'role', 'isActive'],
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Usuario inactivo o no encontrado. Contacte al administrador.',
      );
    }

    return user;
  }
}
