import { Controller, Get, INestApplication, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as request from 'supertest';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: 'test-secret',
    });
  }

  validate(payload: unknown) {
    return payload;
  }
}

@Controller('probe')
class ProbeController {
  @Get('private')
  privateRoute() {
    return { ok: true };
  }

  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }
}

@Public()
@Controller('open')
class OpenController {
  @Get()
  open() {
    return { ok: true };
  }
}

describe('JwtAuthGuard registered as APP_GUARD', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController, OpenController],
      providers: [TestJwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a route without @Public() when no token is sent (401)', async () => {
    const res = await request(app.getHttpServer()).get('/probe/private');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('rejects a route without @Public() when the token is invalid (401)', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/private')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('lets a handler marked with @Public() through without a token', async () => {
    const res = await request(app.getHttpServer()).get('/probe/public');
    expect(res.status).toBe(200);
  });

  it('lets every handler of a controller marked with @Public() through', async () => {
    const res = await request(app.getHttpServer()).get('/open');
    expect(res.status).toBe(200);
  });
});
