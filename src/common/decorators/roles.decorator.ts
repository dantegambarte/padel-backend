import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../modules/users/entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Decorador para proteger endpoints por rol.
 *
 * @example
 * @Roles(UserRole.ADMIN)
 * @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
