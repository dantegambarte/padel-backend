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
   * Obtiene la sesión de caja ABIERTA (independientemente del día calendario)
   * o la crea si no existe ninguna. Implementa el modelo de "Jornada Comercial":
   * si hay una caja abierta del lunes y la venta ocurre a las 00:30 del martes,
   * la venta entra en la caja del lunes.
   *
   * Debe llamarse dentro de un QueryRunner activo.
   * Lanza ServiceUnavailableException si la jornada comercial ya fue cerrada.
   */
  async getOrCreateActiveSession(queryRunner: QueryRunner, userId: string): Promise<CashSession> {
    // Lock global para evitar race conditions al crear una nueva sesión
    await queryRunner.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1)))`, [
      `cash_session:open`,
    ]);

    // Buscar LA ÚLTIMA CAJA ABIERTA (modelo Jornada Comercial)
    const openSession = await queryRunner.manager.findOne(CashSession, {
      where: { status: CashSessionStatus.OPEN },
      order: { openedAt: 'DESC' } as any,
      lock: { mode: 'pessimistic_write' },
    });

    if (openSession) {
      return openSession;
    }

    // No hay caja abierta: crear una nueva para la fecha comercial vigente
    const commercialDate = this.getCommercialDate();

    // Verificar si ya existe una sesión cerrada para esta fecha comercial
    const closedSession = await queryRunner.manager.findOne(CashSession, {
      where: { date: commercialDate },
      lock: { mode: 'pessimistic_write' },
    });

    if (closedSession?.status === CashSessionStatus.CLOSED) {
      throw new ServiceUnavailableException(
        `La caja de la jornada del ${commercialDate} ya fue cerrada. ` +
          'No se pueden registrar más operaciones.',
      );
    }

    const session = queryRunner.manager.create(CashSession, {
      date: commercialDate,
      status: CashSessionStatus.OPEN,
      openedByUserId: userId,
    });

    const saved = await queryRunner.manager.save(CashSession, session);
    this.logger.log(`Sesión de caja abierta automáticamente para jornada del ${commercialDate}`);
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
    transactions: {
      id: string;
      type: string;
      referenceId: string;
      concept: string;
      amountCash: string;
      amountTransfer: string;
      createdAt: string;
      customerName: string | null;
    }[];
    isOpen: boolean;
  }> {
    let session: CashSession | null;

    if (date) {
      // Consulta histórica: buscar por fecha específica
      session = await this.sessionRepo.findOne({
        where: { date },
        relations: ['openedByUser', 'closedByUser'],
      });
    } else {
      // Consulta actual: buscar la última CAJA ABIERTA (Jornada Comercial)
      session = await this.sessionRepo.findOne({
        where: { status: CashSessionStatus.OPEN },
        order: { openedAt: 'DESC' } as any,
        relations: ['openedByUser', 'closedByUser'],
      });

      // Si no hay caja abierta, mostrar la última sesión cerrada
      if (!session) {
        session = await this.sessionRepo.findOne({
          where: { status: CashSessionStatus.CLOSED },
          order: { openedAt: 'DESC' } as any,
          relations: ['openedByUser', 'closedByUser'],
        });
      }
    }

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

    // LEFT JOIN con sales (customerName) y users (empleado que registró el movimiento)
    const transactions = await this.dataSource.query(
      `SELECT
         t.id,
         t.type,
         t.reference_id        AS "referenceId",
         t.concept,
         t.amount_cash         AS "amountCash",
         t.amount_transfer     AS "amountTransfer",
         t.created_at          AS "createdAt",
         s.customer_name       AS "customerName",
         u.full_name           AS "createdByFullName",
         u.username            AS "createdByUsername"
       FROM transactions t
       LEFT JOIN sales s ON s.id = t.reference_id AND t.type = 'sale'
       LEFT JOIN users u ON u.id = t.created_by_user_id
       WHERE t.cash_session_id = $1
       ORDER BY t.created_at DESC`,
      [session.id],
    );

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
    // Buscar la última caja ABIERTA (modelo Jornada Comercial)
    const session = await this.sessionRepo.findOne({
      where: { status: CashSessionStatus.OPEN },
      order: { openedAt: 'DESC' } as any,
    });

    if (!session) {
      throw new NotFoundException(
        'No existe una sesión de caja abierta. No hubo operaciones registradas.',
      );
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
      `CIERRE Z — jornada ${session.date} por ${user.username}. ` +
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

  /**
   * Retorna la fecha comercial vigente en zona horaria Argentina (YYYY-MM-DD).
   * Implementa el "Cutoff Time": cualquier hora entre las 00:00 y las 03:59 AM
   * pertenece comercialmente al día anterior.
   */
  private getCommercialDate(): string {
    const CUTOFF_HOUR = 4;
    const TZ = 'America/Argentina/Buenos_Aires';

    const now = new Date();

    // Extraer hora actual en Argentina usando Intl (más confiable que toLocaleString)
    const hourParts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const currentHour = parseInt(hourParts.find((p) => p.type === 'hour')?.value ?? '12', 10);

    if (currentHour < CUTOFF_HOUR) {
      // Madrugada: pertenece al día comercial anterior
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toLocaleDateString('en-CA', { timeZone: TZ });
    }

    return now.toLocaleDateString('en-CA', { timeZone: TZ });
  }
}
