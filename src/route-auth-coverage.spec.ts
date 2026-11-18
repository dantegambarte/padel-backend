import { readdirSync } from 'fs';
import { join } from 'path';
import { Type } from '@nestjs/common';
import { APP_GUARD, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// AppModule validates the environment when it is imported, and CI unit tests
// run without a .env file. Placeholders keep the import from throwing; this
// spec only reads module metadata and never connects to anything.
const PLACEHOLDER_ENV: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'placeholder',
  DB_PASSWORD: 'placeholder',
  DB_DATABASE: 'placeholder',
  JWT_SECRET: 'x'.repeat(32),
  JWT_REFRESH_SECRET: 'y'.repeat(32),
};
for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) process.env[key] ??= value;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./app.module') as { AppModule: Type };
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator';

/**
 * Routes that are deliberately reachable without a JWT. Adding a route here is a
 * security decision: it must also carry @Public() in its controller.
 */
const EXPECTED_PUBLIC_ROUTES = [
  'GET /health',
  'GET /health/live',
  'GET /health/ready',
  'POST /auth/login',
  'POST /auth/refresh',
];

function findControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

function loadControllers(): Type[] {
  return findControllerFiles(join(__dirname, 'modules')).flatMap((file) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Object.values(require(file) as Record<string, unknown>).filter(
      (exported): exported is Type =>
        typeof exported === 'function' && Reflect.hasMetadata(PATH_METADATA, exported),
    ),
  );
}

function joinPath(...parts: (string | string[] | undefined)[]): string {
  const segments = parts
    .map((p) => (Array.isArray(p) ? p[0] : p) ?? '')
    .flatMap((p) => p.split('/'))
    .filter(Boolean);
  return '/' + segments.join('/');
}

interface Route {
  id: string;
  isPublic: boolean;
}

function collectRoutes(controllers: Type[]): Route[] {
  const scanner = new MetadataScanner();
  const reflector = new Reflector();
  return controllers.flatMap((controller) => {
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string | string[];
    return scanner.getAllMethodNames(controller.prototype).flatMap((name) => {
      const handler = controller.prototype[name] as (...args: unknown[]) => unknown;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (path === undefined) return [];
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, controller]);
      return [{ id: `${method} ${joinPath(prefix, path)}`, isPublic: Boolean(isPublic) }];
    });
  });
}

describe('Route authentication coverage', () => {
  const controllers = loadControllers();
  const routes = collectRoutes(controllers);

  it('discovers every controller registered in the app modules', () => {
    const imports = (Reflect.getMetadata('imports', AppModule) as unknown[]).filter(
      (m): m is Type => typeof m === 'function',
    );
    const registered = imports.flatMap(
      (m) => (Reflect.getMetadata('controllers', m) as Type[] | undefined) ?? [],
    );
    expect(registered.length).toBeGreaterThan(0);
    for (const controller of registered) {
      expect(controllers).toContain(controller);
    }
  });

  it('registers throttler, JWT and roles guards globally, in that order', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as {
      provide?: unknown;
      useClass?: unknown;
    }[];
    const globalGuards = providers.filter((p) => p.provide === APP_GUARD).map((p) => p.useClass);
    expect(globalGuards).toEqual([ThrottlerGuard, JwtAuthGuard, RolesGuard]);
  });

  it('only exposes the expected routes without authentication', () => {
    expect(routes.length).toBeGreaterThan(EXPECTED_PUBLIC_ROUTES.length);
    const publicRoutes = routes.filter((r) => r.isPublic).map((r) => r.id);
    expect(publicRoutes.sort()).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });
});
