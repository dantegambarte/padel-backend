import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PricingShift } from './entities/pricing-shift.entity';
import { CreatePricingShiftDto } from './dto/create-pricing-shift.dto';
import { UpdatePricingShiftDto } from './dto/update-pricing-shift.dto';

@Injectable()
export class PricingShiftsService {
  constructor(
    @InjectRepository(PricingShift)
    private readonly repo: Repository<PricingShift>,
  ) {}

  /** Devuelve todas las franjas horarias (activas e inactivas). Solo Admin. */
  findAll(): Promise<PricingShift[]> {
    return this.repo.find({ order: { isActive: 'DESC', startTime: 'ASC' } });
  }

  /** Devuelve únicamente las franjas activas. Accesible por empleados para previsualizar precios. */
  findActive(): Promise<PricingShift[]> {
    return this.repo.find({
      where: { isActive: true },
      order: { startTime: 'ASC' },
    });
  }

  /** Retorna una franja horaria por ID o lanza NotFoundException. */
  async findOne(id: string): Promise<PricingShift> {
    const shift = await this.repo.findOne({ where: { id } });
    if (!shift) {
      throw new NotFoundException(`Franja horaria con ID ${id} no encontrada.`);
    }
    return shift;
  }

  /** Crea una nueva franja horaria de precios. */
  create(dto: CreatePricingShiftDto): Promise<PricingShift> {
    const shift = this.repo.create({
      name: dto.name,
      startTime: dto.startTime,
      endTime: dto.endTime,
      daysOfWeek: dto.daysOfWeek,
      price30min: dto.price30min ?? 0,
      price60min: dto.price60min,
      price90min: dto.price90min ?? 0,
      price120min: dto.price120min ?? 0,
      teacherPricePerHour: dto.teacherPricePerHour ?? 0,
      isActive: dto.isActive ?? true,
    });
    return this.repo.save(shift);
  }

  /** Actualiza parcialmente una franja horaria. */
  async update(id: string, dto: UpdatePricingShiftDto): Promise<PricingShift> {
    const shift = await this.findOne(id);
    Object.assign(shift, dto);
    return this.repo.save(shift);
  }

  /** Elimina una franja horaria de precios. */
  async remove(id: string): Promise<void> {
    const shift = await this.findOne(id);
    await this.repo.remove(shift);
  }
}
