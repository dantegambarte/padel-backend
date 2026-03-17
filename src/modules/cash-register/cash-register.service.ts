import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { CashSession, CashSessionStatus } from './entities/cash-session.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { User } from '../users/entities/user.entity';
import { CloseSessionDto } from './dto/close-session.dto';

export interface RegisterTransactionInput {
  cashSessionId: string;
  type: TransactionType;
  referenceId: string;
  concept: string;
  amountCash: number;
  amountTransfer: number;
  createdByUserId: string;
}

@Injectable()
export class CashRegisterService {
  private readonly logger = new Logger(CashRegisterService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(CashSession)
    private readonly sessionRepo: Repository<CashSession>,

    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
  ) {}

  /**
   * Obtiene la sesión activa del día o la crea si no existe.
   * Debe llamarse dentro de un QueryRunner activo.
   * Lanza ServiceUnavailableException si la caja ya fue cerrada.
   */
  async getOrCreateActiveSession(queryRunner: QueryRunner, userId: string): Promise<CashSession> {
    const today = this.getToday();

    await queryRunner.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1)))`, [
      `cash_session:${today}`,
    ]);

    const existing = await queryRunner.manager.findOne(CashSession, {
      where: { date: today },
      lock: { mode: 'pessimistic_write' },
    });

    if (existing?.status === CashSessionStatus.CLOSED) {
      throw new ServiceUnavailableException(
        `La caja del ${today} ya fue cerrada. ` +
          'No se pueden registrar más operaciones en este día.',
      );
    }

    if (existing) {
      return existing;
    }

    const session = queryRunner.manager.create(CashSession, {
      date: today,
      status: CashSessionStatus.OPEN,
      openedByUserId: userId,
    });

    const saved = await queryRunner.manager.save(CashSession, session);
    this.logger.log(`Sesión de caja abierta automáticamente para ${today}`);
    return saved;
  }

  /**
   * Registra un movimiento financiero en la sesión de caja.
   * Debe llamarse dentro del mismo QueryRunner que la operación origen.
   */
  async registerTransaction(
    queryRunner: QueryRunner,
    data: RegisterTransactionInput,
  ): Promise<Transaction> {
    const tx = queryRunner.manager.create(Transaction, {
      cashSessionId: data.cashSessionId,
      type: data.type,
      referenceId: data.referenceId,
      concept: data.concept,
      amountCash: data.amountCash,
      amountTransfer: data.amountTransfer,
      createdByUserId: data.createdByUserId,
    });

    return queryRunner.manager.save(Transaction, tx);
  }

  /** Retorna el estado completo de la caja: totales, movimientos y si está abierta. */
  async getCurrentSession(date?: string): Promise<{
    session: CashSession | null;
    cashExpected: number;
    transferTotal: number;
    dayTotal: number;
    transactions: Transaction[];
    isOpen: boolean;
  }> {
    const targetDate = date ?? this.getToday();

    const session = await this.sessionRepo.findOne({
      where: { date: targetDate },
      relations: ['openedByUser', 'closedByUser'],
    });

    if (!session) {
      return {
        session: null,
        cashExpected: 0,
        transferTotal: 0,
        dayTotal: 0,
        transactions: [],
        isOpen: true,
      };
    }

    const totals = await this.dataSource.query<{ cash_expected: string; transfer_total: string }[]>(
      `SELECT
         COALESCE(SUM(amount_cash), 0)       AS cash_expected,
         COALESCE(SUM(amount_transfer), 0)   AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashExpected = parseFloat(totals[0]?.cash_expected ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');

    const transactions = await this.transactionRepo.find({
      where: { cashSessionId: session.id },
      relations: ['createdByUser'],
      order: { createdAt: 'DESC' },
    });

    return {
      session,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      transactions,
      isOpen: session.status === CashSessionStatus.OPEN,
    };
  }

  /**
   * Ejecuta el cierre Z: calcula la diferencia entre lo contado y lo esperado,
   * cierra la sesión e impide nuevas operaciones para el día.
   */
  async closeSession(
    dto: CloseSessionDto,
    user: User,
  ): Promise<{
    session: CashSession;
    cashExpected: number;
    transferTotal: number;
    dayTotal: number;
    difference: number;
    balances: 'exact' | 'surplus' | 'shortage';
  }> {
    const today = this.getToday();

    const session = await this.sessionRepo.findOne({
      where: { date: today },
    });

    if (!session) {
      throw new NotFoundException(
        'No existe una sesión de caja abierta para hoy. ' + 'No hubo operaciones registradas.',
      );
    }

    if (session.status === CashSessionStatus.CLOSED) {
      throw new ConflictException('La caja de hoy ya fue cerrada anteriormente.');
    }

    const totals = await this.dataSource.query<{ cash_expected: string; transfer_total: string }[]>(
      `SELECT
         COALESCE(SUM(amount_cash), 0)     AS cash_expected,
         COALESCE(SUM(amount_transfer), 0) AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashExpected = parseFloat(totals[0]?.cash_expected ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');
    const difference = dto.cashCounted - cashExpected;

    session.status = CashSessionStatus.CLOSED;
    session.closedByUserId = user.id;
    session.cashCounted = dto.cashCounted;
    session.difference = difference;
    session.notes = dto.notes ?? '';
    session.closedAt = new Date();

    await this.sessionRepo.save(session);

    this.logger.log(
      `CIERRE Z — ${today} por ${user.username}. ` +
        `Esperado: $${cashExpected} | Contado: $${dto.cashCounted} | ` +
        `Diferencia: ${difference >= 0 ? '+' : ''}$${difference}`,
    );

    const balances = difference === 0 ? 'exact' : difference > 0 ? 'surplus' : 'shortage';

    return {
      session,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      difference,
      balances,
    };
  }

  /** Retorna la fecha actual en zona horaria Argentina (YYYY-MM-DD). */
  private getToday(): string {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  }
}
