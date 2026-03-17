import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SystemConfigService } from './system-config.service';
import { SystemConfig } from './entities/system-config.entity';

const mockConfig = (key: string, value: string): SystemConfig =>
  ({ key, value, description: '', updatedAt: new Date() }) as SystemConfig;

describe('SystemConfigService', () => {
  let service: SystemConfigService;

  const configRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemConfigService,
        { provide: getRepositoryToken(SystemConfig), useValue: configRepo },
      ],
    }).compile();

    service = module.get<SystemConfigService>(SystemConfigService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('retorna todas las claves como array { key, value }', async () => {
      configRepo.find.mockResolvedValue([mockConfig('precio_estandar', '3000')]);
      const result = await service.findAll();
      expect(result).toEqual([{ key: 'precio_estandar', value: '3000' }]);
    });
  });

  describe('findByKey', () => {
    it('retorna el valor de una clave existente', async () => {
      configRepo.findOne.mockResolvedValue(mockConfig('precio_estandar', '3000'));
      const result = await service.findByKey('precio_estandar');
      expect(result).toBe('3000');
    });

    it('lanza NotFoundException si la clave no existe', async () => {
      configRepo.findOne.mockResolvedValue(null);
      await expect(service.findByKey('no_existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('actualiza el valor de una clave existente', async () => {
      const config = mockConfig('precio_estandar', '3000');
      configRepo.findOne.mockResolvedValue(config);
      configRepo.save.mockResolvedValue({ ...config, value: '4000' });

      const result = await service.update('precio_estandar', '4000');
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({ value: '4000' }));
    });

    it('lanza NotFoundException si la clave no existe', async () => {
      configRepo.findOne.mockResolvedValue(null);
      await expect(service.update('no_existe', '100')).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkUpdate', () => {
    it('retorna el estado actual si el objeto está vacío', async () => {
      configRepo.find.mockResolvedValue([mockConfig('precio_estandar', '3000')]);
      const result = await service.bulkUpdate({});
      expect(result).toEqual([{ key: 'precio_estandar', value: '3000' }]);
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('actualiza múltiples claves en una sola llamada', async () => {
      const config = mockConfig('precio_estandar', '3000');
      configRepo.findOne.mockResolvedValue(config);
      configRepo.save.mockResolvedValue({ ...config, value: '5000' });
      configRepo.find.mockResolvedValue([{ ...config, value: '5000' }]);

      const result = await service.bulkUpdate({ precio_estandar: '5000' });
      expect(configRepo.save).toHaveBeenCalledTimes(1);
    });

    it('maneja null/undefined como objeto vacío', async () => {
      configRepo.find.mockResolvedValue([]);
      await service.bulkUpdate(null as any);
      expect(configRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getPrices', () => {
    it('retorna los precios parseados como números', async () => {
      configRepo.find.mockResolvedValue([
        mockConfig('precio_estandar', '3500'),
        mockConfig('precio_profesor', '2800'),
      ]);

      const result = await service.getPrices();
      expect(result.standard).toBe(3500);
      expect(result.professor).toBe(2800);
    });

    it('usa valores por defecto si las claves no están cargadas', async () => {
      configRepo.find.mockResolvedValue([]);
      const result = await service.getPrices();
      expect(result.standard).toBe(3000);
      expect(result.professor).toBe(2500);
    });
  });
});
