/**
 * E2E test: logout y rotación de refresh tokens contra Postgres real.
 *
 * Run with:
 *   pnpm test:e2e -- --testPathPatterns=auth.e2e-spec
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module';
import { User, UserRole } from '../users/entities/user.entity';

const USERNAME = 'e2e_auth_rotation';
const PASSWORD = 'E2eAuthRotation#1';

describe('Auth logout and refresh rotation (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let userId: string;

  const http = () => request(app.getHttpServer());
  /** The raw Set-Cookie line for refresh_token, if the response set one. */
  const refreshSetCookie = (res: request.Response): string | undefined => {
    const header = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const lines = Array.isArray(header) ? header : header ? [header] : [];
    return lines.find((l) => l.startsWith('refresh_token='));
  };
  const cookieValue = (line: string) => line.split(';')[0].slice('refresh_token='.length);
  const withTokens = (res: request.Response) => {
    const line = refreshSetCookie(res);
    if (!line) throw new Error('refresh_token cookie not set');
    return {
      accessToken: (res.body as { accessToken: string }).accessToken,
      refreshToken: cookieValue(line),
    };
  };
  const login = async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    return withTokens(res);
  };
  /** Refresh the way the browser does: cookie only, empty body. */
  const refresh = (refreshToken: string) =>
    http().post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${refreshToken}`);
  const me = (accessToken: string) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = moduleFixture.get(DataSource);

    const repo = ds.getRepository(User);
    await repo.delete({ username: USERNAME });
    const user = await repo.save(
      repo.create({
        username: USERNAME,
        fullName: 'E2E Auth Rotation',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        role: UserRole.EMPLOYEE,
      }),
    );
    userId = user.id;
  });

  afterAll(async () => {
    await ds.getRepository(User).delete(userId);
    await app.close();
  });

  it('rotates the refresh token: the new one works, the used one does not', async () => {
    const first = await login();
    const second = withTokens(await refresh(first.refreshToken).expect(200));

    await me(second.accessToken).expect(200);
    await refresh(second.refreshToken).expect(200);
  });

  it('revokes the whole session when a rotated refresh token is reused', async () => {
    const first = await login();
    const second = withTokens(await refresh(first.refreshToken).expect(200));

    await refresh(first.refreshToken).expect(401);

    // The legitimate tokens die too: the session was revoked.
    await refresh(second.refreshToken).expect(401);
    await me(second.accessToken).expect(401);
  });

  it('logout invalidates the access and refresh tokens of the session', async () => {
    const session = await login();

    await http()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(204);

    await me(session.accessToken).expect(401);
    await refresh(session.refreshToken).expect(401);
  });

  it('login sets the refresh cookie with its flags and keeps it out of the body', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).not.toHaveProperty('refreshToken');
    const line = refreshSetCookie(res)!;
    expect(line).toBeDefined();
    expect(line).toMatch(/; HttpOnly/);
    expect(line).toMatch(/; SameSite=Strict/);
    expect(line).toContain('; Path=/api/v1/auth');
    expect(line).toMatch(/; Max-Age=\d+/);
    // NODE_ENV is not production in tests, so the cookie must work over http.
    expect(line).not.toMatch(/; Secure/);
  });

  it('refresh via cookie returns only the access token and rotates the cookie', async () => {
    const session = await login();
    const res = await refresh(session.refreshToken).expect(200);

    expect(Object.keys(res.body as object)).toEqual(['accessToken']);
    const rotated = cookieValue(refreshSetCookie(res)!);
    expect(rotated).not.toBe(session.refreshToken);
    await me((res.body as { accessToken: string }).accessToken).expect(200);
  });

  it('TRANSITIONAL: refresh still accepts the body field', async () => {
    const session = await login();
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
  });

  it('refresh without cookie and without body is 401', async () => {
    await http().post('/api/v1/auth/refresh').expect(401);
  });

  it('logout clears the refresh cookie', async () => {
    const session = await login();
    const res = await http()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(204);

    const line = refreshSetCookie(res)!;
    expect(line).toBeDefined();
    expect(line).toMatch(/^refresh_token=;/);
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(line).toContain('; Path=/api/v1/auth');
  });

  it('a new login invalidates the refresh token of the previous session', async () => {
    const previous = await login();
    await login();
    await refresh(previous.refreshToken).expect(401);
  });
});
