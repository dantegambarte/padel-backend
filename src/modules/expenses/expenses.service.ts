import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Expense, ExpenseCategory, PaymentMethod } from './entities/expense.entity';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { UserRole } from '../users/entities/user.entity';

/** Categorías que solo el administrador puede registrar. */
const ADMIN_ONLY_CATEGORIES = new Set<ExpenseCategory>([ExpenseCategory.SALARY]);

/** Fecha comercial de hoy en Argentina (YYYY-MM-DD, corte a las 3 AM). */
function businessDateToday(): string {
  const now = new Date();
  const ar = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  if (ar.getHours() < 3) ar.setDate(ar.getDate() - 1);
  const y = ar.getFullYear();
  const m = String(ar.getMonth() + 1).padStart(2, '0');
  const d = String(ar.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface FindAllOptions {
  role: UserRole;
  from?: string;
  to?: string;
  userId?: string;
}

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Crea un nuevo egreso vinculando el usuario que lo genera.
   * REGLA DE NEGOCIO: Si el método de pago es Efectivo, vincula la sesión de
   * caja actualmente ABIERTA para que el gasto impacte en el Cierre Z.
   */
  async create(
    dto: CreateExpenseDto,
    createdByUserId: string,
    userRole: UserRole,
  ): Promise<Expense> {
    if (userRole !== UserRole.ADMIN && ADMIN_ONLY_CATEGORIES.has(dto.category as ExpenseCategory)) {
      throw new ForbiddenException(
        'No tienes permisos suficientes para registrar gastos en esta categoría administrativa.',
      );
    }

    const expense = this.expenseRepo.create({ ...dto, createdByUserId });

    if (dto.paymentMethod === PaymentMethod.CASH) {
      const sessionData = await this.cashRegisterService.getCurrentSession();
      if (!sessionData.session || !sessionData.isOpen) {
        throw new BadRequestException({
          errorCode: 'CAJA_CERRADA',
          message: 'Debes abrir la caja antes de registrar un egreso en efectivo.',
        });
      }

      const availableCash = sessionData.initialBalance + sessionData.cashExpected;
      if (dto.amount > availableCash) {
        const fmt = (n: number) =>
          n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        throw new BadRequestException(
          `No hay suficiente dinero en efectivo en la caja para registrar este egreso. ` +
            `Disponible: $${fmt(availableCash)}`,
        );
      }

      expense.cashSessionId = sessionData.session.id;
    }

    return this.expenseRepo.save(expense);
  }

  /**
   * Devuelve egresos según el rol del solicitante:
   * - ADMIN: todos los egresos, opcionalmente filtrados por rango de fechas.
   * - EMPLOYEE: egresos creados por ese empleado en el turno activo (desde openedAt de la sesión OPEN).
   *   Si no hay sesión abierta, retorna array vacío.
   */
  async findAll(options: FindAllOptions): Promise<Expense[]> {
    const qb = this.expenseRepo
      .createQueryBuilder('expense')
      .leftJoin('expense.createdByUser', 'creator')
      .addSelect(['creator.id', 'creator.fullName', 'creator.role'])
      .orderBy('expense.createdAt', 'DESC');

    if (options.role === UserRole.ADMIN) {
      if (options.from) {
        qb.andWhere('expense.date >= :from', { from: options.from });
      }
      if (options.to) {
        qb.andWhere('expense.date <= :to', { to: options.to });
      }
    } else {
      const sessionData = await this.cashRegisterService.getCurrentSession();
      if (!sessionData.session || !sessionData.isOpen) {
        return [];
      }
      qb.andWhere('expense.createdAt >= :openedAt', {
        openedAt: sessionData.session.openedAt,
      }).andWhere('expense.createdByUserId = :userId', {
        userId: options.userId,
      });
    }

    return qb.getMany();
  }

  /** Busca un egreso por UUID. Lanza 404 si no existe o fue eliminado. */
  async findOne(id: string): Promise<Expense> {
    const expense = await this.expenseRepo.findOne({
      where: { id },
      relations: ['createdByUser'],
    });
    if (!expense) {
      throw new NotFoundException(`Egreso con id "${id}" no encontrado.`);
    }
    return expense;
  }

  /** Actualiza parcialmente un egreso existente. */
  async update(id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.findOne(id);
    Object.assign(expense, dto);

    if (dto.paymentMethod === PaymentMethod.CASH && !expense.cashSessionId) {
      const sessionData = await this.cashRegisterService.getCurrentSession();
      if (!sessionData.session || !sessionData.isOpen) {
        throw new BadRequestException({
          errorCode: 'CAJA_CERRADA',
          message: 'Debes abrir la caja antes de registrar un egreso en efectivo.',
        });
      }
      expense.cashSessionId = sessionData.session.id;
    }

    if (dto.paymentMethod && dto.paymentMethod !== PaymentMethod.CASH) {
      expense.cashSessionId = null;
    }

    return this.expenseRepo.save(expense);
  }

  /** Soft delete. */
  async remove(id: string): Promise<void> {
    const expense = await this.findOne(id);
    await this.expenseRepo.softRemove(expense);
  }
}
