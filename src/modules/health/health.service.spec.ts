import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const dataSource = { query: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService, { provide: DataSource, useValue: dataSource }],
    }).compile();
    service = module.get(HealthService);
  });

  it('retorna true cuando SELECT 1 responde', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    await expect(service.isDatabaseUp()).resolves.toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('retorna false cuando la consulta falla', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    await expect(service.isDatabaseUp()).resolves.toBe(false);
  });

  it('retorna false cuando la consulta excede el timeout', async () => {
    jest.useFakeTimers();
    try {
      dataSource.query.mockReturnValue(new Promise(() => undefined));
      const result = service.isDatabaseUp();
      jest.advanceTimersByTime(2_000);
      await expect(result).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
