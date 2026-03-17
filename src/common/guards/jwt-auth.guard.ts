import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';

/** Guard JWT que convierte errores de token en mensajes descriptivos. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  /** Lanza UnauthorizedException con mensaje específico según el tipo de error JWT. */
  handleRequest(err: any, user: any, info: any) {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException('Tu sesión ha expirado. Por favor volvé a iniciar sesión.');
    }
    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException('Token inválido.');
    }
    if (err || !user) {
      throw new UnauthorizedException('No autorizado.');
    }
    return user;
  }
}
