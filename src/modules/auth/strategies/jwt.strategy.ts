import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export interface JwtPayload {
  sub: string; // user.id
  username: string;
  role: string;
}

/**
 * Valida el JWT en cada request protegido.
 * Carga el usuario completo desde la DB para asegurar que sigue
 * activo (un empleado desactivado no puede seguir operando aunque
 * su token aún no haya expirado).
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
