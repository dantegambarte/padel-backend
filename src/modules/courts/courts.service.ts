import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Court } from './entities/court.entity';
import { CreateCourtDto, UpdateCourtDto } from './dto/create-court.dto';

@Injectable()
export class CourtsService {
  constructor(
    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,
  ) {}

  /** Retorna todas las canchas, opcionalmente solo las activas. */
  findAll(onlyActive = false): Promise<Court[]> {
    return this.courtRepo.find({
      where: onlyActive ? { isActive: true } : {},
      order: { name: 'ASC' },
    });
  }

  /** Retorna una cancha por ID. */
  async findOne(id: string): Promise<Court> {
    const court = await this.courtRepo.findOne({ where: { id } });
    if (!court) {
      throw new NotFoundException(`Cancha con ID ${id} no encontrada.`);
    }
    return court;
  }

  /** Crea una cancha validando unicidad de nombre. */
  async create(dto: CreateCourtDto): Promise<Court> {
    const existing = await this.courtRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Ya existe una cancha con el nombre "${dto.name}".`);
    }
    const court = this.courtRepo.create(dto);
    return this.courtRepo.save(court);
  }

  /** Actualiza parcialmente una cancha. */
  async update(id: string, dto: UpdateCourtDto): Promise<Court> {
    const court = await this.findOne(id);
    Object.assign(court, dto);
    return this.courtRepo.save(court);
  }
}
