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
import { AppModule } from '../../app.module';
import { User, UserRole } from '../users/entities/user.entity';

const USERNAME = 'e2e_auth_rotation';
const PASSWORD = 'E2eAuthRotation#1';

describe('Auth logout and refresh rotation (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let userId: string;

  const http = () => request(app.getHttpServer());
  const login = async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  };
  const refresh = (refreshToken: string) =>
    http().post('/api/v1/auth/refresh').send({ refreshToken });
  const me = (accessToken: string) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
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
    const second = (await refresh(first.refreshToken).expect(200)).body as typeof first;

    await me(second.accessToken).expect(200);
    await refresh(second.refreshToken).expect(200);
  });

  it('revokes the whole session when a rotated refresh token is reused', async () => {
    const first = await login();
    const second = (await refresh(first.refreshToken).expect(200)).body as typeof first;

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

  it('a new login invalidates the refresh token of the previous session', async () => {
    const previous = await login();
    await login();
    await refresh(previous.refreshToken).expect(401);
  });
});
