import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Guard JWT que convierte errores de token en mensajes descriptivos. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /** Registered globally: every route requires a JWT unless it is marked with @Public(). */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
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

    if (err instanceof UnauthorizedException) {
      try {
        const parsed = JSON.parse(err.message);
        if (parsed?.error === 'SESSION_OVERRIDDEN') {
          throw new UnauthorizedException(parsed);
        }
      } catch {
        console.error(
          'JwtAuthGuard.handleRequest: error parsing UnauthorizedException message:',
          err,
        );
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
