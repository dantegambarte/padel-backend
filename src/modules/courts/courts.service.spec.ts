import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CourtsService } from './courts.service';
import { Court } from './entities/court.entity';

const mockCourt = (overrides: Partial<Court> = {}): Court =>
  ({
    id: 'court-uuid',
    name: 'Cancha 1',
    description: 'Cancha principal',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Court;

describe('CourtsService', () => {
  let service: CourtsService;

  const courtRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourtsService,
        { provide: getRepositoryToken(Court), useValue: courtRepo },
      ],
    }).compile();

    service = module.get<CourtsService>(CourtsService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('retorna todas las canchas sin filtro', async () => {
      courtRepo.find.mockResolvedValue([mockCourt()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(courtRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filtra solo activas cuando onlyActive es true', async () => {
      courtRepo.find.mockResolvedValue([mockCourt()]);
      await service.findAll(true);
      expect(courtRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('findOne', () => {
    it('retorna la cancha si existe', async () => {
      courtRepo.findOne.mockResolvedValue(mockCourt());
      const result = await service.findOne('court-uuid');
      expect(result.id).toBe('court-uuid');
    });

    it('lanza NotFoundException si no existe', async () => {
      courtRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('crea una cancha con nombre único', async () => {
      courtRepo.findOne.mockResolvedValue(null);
      const court = mockCourt();
      courtRepo.create.mockReturnValue(court);
      courtRepo.save.mockResolvedValue(court);

      const result = await service.create({ name: 'Cancha 1' });
      expect(result.name).toBe('Cancha 1');
    });

    it('lanza ConflictException si el nombre ya existe', async () => {
      courtRepo.findOne.mockResolvedValue(mockCourt());
      await expect(service.create({ name: 'Cancha 1' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('actualiza los campos de la cancha', async () => {
      const court = mockCourt();
      courtRepo.findOne.mockResolvedValue(court);
      courtRepo.save.mockResolvedValue({ ...court, name: 'Cancha Actualizada' });

      const result = await service.update('court-uuid', { name: 'Cancha Actualizada' });
      expect(courtRepo.save).toHaveBeenCalled();
    });

    it('lanza NotFoundException si la cancha no existe', async () => {
      courtRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });
});
