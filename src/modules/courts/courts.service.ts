import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Court } from './entities/court.entity';
import { CreateCourtDto, UpdateCourtDto } from './dto/create-court.dto';

@Injectable()
export class CourtsService {
  private readonly logger = new Logger(CourtsService.name);

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
    const saved = await this.courtRepo.save(court);
    this.logger.log(`Cancha creada: "${saved.name}" (id=${saved.id})`);
    return saved;
  }

  /** Actualiza parcialmente una cancha. */
  async update(id: string, dto: UpdateCourtDto): Promise<Court> {
    const court = await this.findOne(id);
    Object.assign(court, dto);
    const saved = await this.courtRepo.save(court);
    this.logger.log(`Cancha actualizada: "${saved.name}" (id=${id})`);
    return saved;
  }

  /** Elimina una cancha si no tiene turnos asociados. */
  async remove(id: string): Promise<{ deleted: true }> {
    const court = await this.findOne(id);
    const bookingCount = await this.courtRepo
      .createQueryBuilder('court')
      .innerJoin('court.bookings', 'booking')
      .where('court.id = :id', { id })
      .getCount();
    if (bookingCount > 0) {
      this.logger.warn(
        `Intento de eliminar cancha "${court.name}" (id=${id}) con ${bookingCount} turno(s) asociado(s)`,
      );
      throw new BadRequestException(
        'No se puede eliminar la cancha porque tiene turnos asociados. Te recomendamos inactivarla.',
      );
    }
    await this.courtRepo.remove(court);
    this.logger.log(`Cancha eliminada: "${court.name}" (id=${id})`);
    return { deleted: true };
  }
}
