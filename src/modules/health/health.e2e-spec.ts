/**
 * E2E test: GET /health
 *
 * Prerequisites: running PostgreSQL and env vars set (see other e2e specs).
 * Run with: pnpm test:e2e -- --testPathPatterns=health.e2e-spec
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { resolveThrottleLimits } from '../../config/throttle-limits';

// Production global limit: CI relaxes the live limits (E2E_RELAX_THROTTLE=1),
// so derive the request count from the unrelaxed values instead.
const PRODUCTION_GLOBAL_LIMIT = resolveThrottleLimits({ NODE_ENV: 'production' }).global;

describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 { status: ok, db: up } sin token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('no aplica el rate limit global', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i <= PRODUCTION_GLOBAL_LIMIT; i++) {
      await request(server).get('/api/v1/health').expect(200);
    }
  }, 30_000);
});
