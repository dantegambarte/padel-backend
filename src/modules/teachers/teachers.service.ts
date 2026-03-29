import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Teacher } from './entities/teacher.entity';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

@Injectable()
export class TeachersService {
  constructor(
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,
  ) {}

  /**
   * Lista profesores ordenados alfabéticamente.
   * @param includeInactive - `false` (por defecto): solo activos.
   *                          `true`: activos e inactivos (uso exclusivo de admin).
   */
  findAll(includeInactive = false): Promise<Teacher[]> {
    return this.teacherRepo.find({
      where: includeInactive ? undefined : { isActive: true },
      order: { fullName: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Teacher> {
    const teacher = await this.teacherRepo.findOne({ where: { id } });
    if (!teacher) {
      throw new NotFoundException(`Profesor con id "${id}" no encontrado`);
    }
    return teacher;
  }

  create(dto: CreateTeacherDto): Promise<Teacher> {
    const teacher = this.teacherRepo.create({
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber ?? null,
      email:       dto.email       ?? null,
    });
    return this.teacherRepo.save(teacher);
  }

  async update(id: string, dto: UpdateTeacherDto): Promise<Teacher> {
    const teacher = await this.findOne(id);

    if (dto.fullName    !== undefined) teacher.fullName    = dto.fullName;
    if (dto.phoneNumber !== undefined) teacher.phoneNumber = dto.phoneNumber ?? null;
    if (dto.email       !== undefined) teacher.email       = dto.email       ?? null;
    if (dto.isActive    !== undefined) teacher.isActive    = dto.isActive;

    return this.teacherRepo.save(teacher);
  }

  /** Soft-delete: marca isActive = false. */
  async deactivate(id: string): Promise<void> {
    const teacher = await this.findOne(id);
    teacher.isActive = false;
    await this.teacherRepo.save(teacher);
  }
}
