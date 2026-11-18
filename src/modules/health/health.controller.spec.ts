import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  const healthService = { isDatabaseUp: jest.fn() };
  const res = { status: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();
    controller = module.get(HealthController);
  });

  it('responde 200 { status: ok, db: up } con la base arriba', async () => {
    healthService.isDatabaseUp.mockResolvedValue(true);
    const body = await controller.check(res as never);
    expect(body).toEqual({ status: 'ok', db: 'up' });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('responde 503 { status: error, db: down } con la base caída', async () => {
    healthService.isDatabaseUp.mockResolvedValue(false);
    const body = await controller.check(res as never);
    expect(body).toEqual({ status: 'error', db: 'down' });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('liveness responde 200 { status: ok } sin consultar la base', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(healthService.isDatabaseUp).not.toHaveBeenCalled();
  });

  it('readiness responde 200 { status: ok, db: up } con la base arriba', async () => {
    healthService.isDatabaseUp.mockResolvedValue(true);
    expect(await controller.ready(res as never)).toEqual({ status: 'ok', db: 'up' });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('readiness responde 503 { status: error, db: down } con la base caida', async () => {
    healthService.isDatabaseUp.mockResolvedValue(false);
    expect(await controller.ready(res as never)).toEqual({ status: 'error', db: 'down' });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
