import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or a whole controller) as reachable without a JWT.
 * The global JwtAuthGuard skips authentication when this metadata is present.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
