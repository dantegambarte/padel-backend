import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';

/** Guard JWT que convierte errores de token en mensajes descriptivos. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  /**
   * Lanza UnauthorizedException con mensaje específico según el tipo de error JWT.
   * SESSION_OVERRIDDEN: la strategy lo lanza como JSON en el message — lo propagamos
   * tal cual para que el frontend pueda discriminar por `error` code.
   */
  handleRequest(err: any, user: any, info: any) {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException({
        error: 'TOKEN_EXPIRED',
        message: 'Tu sesión ha expirado. Por favor volvé a iniciar sesión.',
      });
    }

    // La strategy lanza UnauthorizedException con JSON en el message para SESSION_OVERRIDDEN
    if (err instanceof UnauthorizedException) {
      try {
        const parsed = JSON.parse(err.message);
        if (parsed?.error === 'SESSION_OVERRIDDEN') {
          throw new UnauthorizedException(parsed);
        }
      } catch {
        // no era JSON, caer al default
      }
      throw err;
    }

    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException({
        error: 'INVALID_TOKEN',
        message: 'Token inválido.',
      });
    }

    if (!user) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'No autorizado.' });
    }

    return user;
  }
}
