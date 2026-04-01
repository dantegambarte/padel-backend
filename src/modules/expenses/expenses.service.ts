import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Expense, PaymentMethod } from './entities/expense.entity';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { CashRegisterService } from '../cash-register/cash-register.service';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Crea un nuevo egreso.
   * REGLA DE NEGOCIO: Si el método de pago es Efectivo, vincula la sesión de
   * caja actualmente ABIERTA para que el gasto impacte en el Cierre Z.
   */
  async create(dto: CreateExpenseDto): Promise<Expense> {
    const expense = this.expenseRepo.create(dto);

    if (dto.paymentMethod === PaymentMethod.CASH) {
      const sessionData = await this.cashRegisterService.getCurrentSession();
      if (!sessionData.session || !sessionData.isOpen) {
        throw new BadRequestException({
          errorCode: 'CAJA_CERRADA',
          message: 'Debes abrir la caja antes de registrar un egreso en efectivo.',
        });
      }

      // Restricción física: no se puede gastar más efectivo del que hay en el cajón.
      // Disponible = Fondo inicial + Ingresos en efectivo − Egresos ya registrados
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

  /** Devuelve todos los egresos ordenados del más reciente al más antiguo (sin soft-deleted). */
  findAll(): Promise<Expense[]> {
    return this.expenseRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  /** Busca un egreso por UUID. Lanza 404 si no existe o fue eliminado. */
  async findOne(id: string): Promise<Expense> {
    const expense = await this.expenseRepo.findOne({ where: { id } });
    if (!expense) {
      throw new NotFoundException(`Egreso con id "${id}" no encontrado.`);
    }
    return expense;
  }

  /** Actualiza parcialmente un egreso existente. */
  async update(id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.findOne(id);
    Object.assign(expense, dto);

    // Si se cambia el método de pago a Efectivo, exige caja abierta y re-vincula
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

    // Si se cambia a método no-efectivo, desvincula la sesión de caja
    if (dto.paymentMethod && dto.paymentMethod !== PaymentMethod.CASH) {
      expense.cashSessionId = null;
    }

    return this.expenseRepo.save(expense);
  }

  /** Soft delete: marca `deletedAt` sin eliminar el registro físicamente. */
  async remove(id: string): Promise<void> {
    const expense = await this.findOne(id);
    await this.expenseRepo.softRemove(expense);
  }
}
