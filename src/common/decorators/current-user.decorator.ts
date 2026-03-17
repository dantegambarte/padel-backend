import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../modules/users/entities/user.entity';

/**
 * Extrae el usuario autenticado del request.
 * El usuario es inyectado por JwtStrategy en el campo request.user.
 *
 * @example
 * async getProfile(@CurrentUser() user: User) { ... }
 * async getProfile(@CurrentUser('id') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (field: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: User = request.user;
    return field ? user?.[field] : user;
  },
);
