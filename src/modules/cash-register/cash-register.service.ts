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

// ─────────────────────────────────────────────────────────────────────────────
//  DISEÑO DE LA ENTIDAD TRANSACTION — Referencia Polimórfica
// ─────────────────────────────────────────────────────────────────────────────
//
//  Problema: un movimiento de caja puede originarse en dos tablas diferentes:
//    - bookings   → pago de un turno de cancha
//    - sales      → venta desde el POS de mostrador
//
//  Solución elegida: REFERENCIA POLIMÓRFICA con discriminador de tipo.
//
//  Alternativa descartada (dos FKs):
//    booking_id UUID REFERENCES bookings(id) NULL
//    sale_id    UUID REFERENCES sales(id)    NULL
//
//  Problema de las dos FKs: siempre una columna es NULL, el schema se vuelve
//  rígido, y agregar un tercer tipo (ej: 'ajuste_manual') requiere migration.
//
//  Solución adoptada:
//    type        ENUM('booking', 'sale')   ← discriminador
//    reference_id UUID (nullable)          ← SIN FK de DB
//
//  La integridad referencial se mantiene a NIVEL DE APLICACIÓN:
//    - Cuando type = BOOKING → referenceId es siempre un booking.id válido,
//      porque es el propio BookingsService quien lo escribe.
//    - Cuando type = SALE    → referenceId es siempre un sale.id válido,
//      porque es el propio PosService quien lo escribe.
//    - Nunca se puede insertar una Transaction desde un endpoint externo
//      sin pasar por esos servicios.
//
//  Beneficios:
//    1. Schema extensible: un futuro tipo 'retiro' o 'ajuste' no requiere
//       migration de columnas.
//    2. Query sencilla con CASE WHEN:
//       SELECT type, reference_id, concept, amount_cash + amount_transfer as total
//       FROM transactions WHERE cash_session_id = :id ORDER BY created_at
//    3. Historial completo unificado en una sola tabla.
//
//  Trade-off aceptado: sin FK en DB, pero compensado con la restricción
//  a nivel de servicio (nadie llama a registerTransaction directamente).
// ─────────────────────────────────────────────────────────────────────────────

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

  // ───────────────────────────────────────────────────────────────────────────
  //  MÉTODOS INTERNOS — llamados dentro de transacciones externas
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Obtiene la sesión de caja activa del día, o la crea si no existe.
   *
   * DEBE llamarse dentro de un QueryRunner activo (Bookings / POS).
   * El advisory lock garantiza que solo una sesión se crea por día
   * incluso bajo alta concurrencia.
   *
   * Si la caja del día ya está CERRADA → lanza ServiceUnavailableException,
   * lo que provoca ROLLBACK de toda la operación de origen (turno o venta).
   */
  async getOrCreateActiveSession(
    queryRunner: QueryRunner,
    userId: string,
  ): Promise<CashSession> {
    const today = this.getToday();

    // Advisory lock: serializa la creación de sesiones del mismo día
    await queryRunner.query(
      `SELECT pg_advisory_xact_lock(abs(hashtext($1)))`,
      [`cash_session:${today}`],
    );

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

    // Primera operación del día: crear sesión automáticamente
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
   *
   * DEBE llamarse dentro del mismo QueryRunner que la operación origen
   * (booking o sale). Así, si la operación origen hace ROLLBACK, esta
   * Transaction también se revierte → nunca queda un movimiento huérfano.
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

  // ───────────────────────────────────────────────────────────────────────────
  //  MÉTODOS PÚBLICOS — endpoints del controlador
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * GET /cash/current
   * Estado completo de la caja del día:
   *  - Efectivo esperado (suma de amountCash de todas las transactions)
   *  - Total transferencias (suma de amountTransfer)
   *  - Total del día
   *  - Listado de movimientos con detalle
   *  - Estado de la sesión (abierta / cerrada)
   */
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
      // No hubo operaciones hoy aún
      return {
        session: null,
        cashExpected: 0,
        transferTotal: 0,
        dayTotal: 0,
        transactions: [],
        isOpen: true,
      };
    }

    // Calcular totales en tiempo real desde la tabla de transactions
    const totals = await this.dataSource.query<
      { cash_expected: string; transfer_total: string }[]
    >(
      `SELECT
         COALESCE(SUM(amount_cash), 0)       AS cash_expected,
         COALESCE(SUM(amount_transfer), 0)   AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashExpected = parseFloat(totals[0]?.cash_expected ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');

    // Movimientos del día ordenados por hora (para el historial del frontend)
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
   * POST /cash/close — Cierre Z
   *
   * 1. Obtiene la sesión del día (error si no existe o ya está cerrada)
   * 2. Calcula el efectivo esperado sumando las transactions
   * 3. Calcula la diferencia: cashCounted - cashExpected
   * 4. Cierra la sesión y la persiste
   *
   * Después del cierre, cualquier intento de booking o venta del mismo día
   * disparará ServiceUnavailableException via getOrCreateActiveSession().
   */
  async closeSession(dto: CloseSessionDto, user: User): Promise<{
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
        'No existe una sesión de caja abierta para hoy. ' +
          'No hubo operaciones registradas.',
      );
    }

    if (session.status === CashSessionStatus.CLOSED) {
      throw new ConflictException('La caja de hoy ya fue cerrada anteriormente.');
    }

    // Calcular efectivo esperado del sistema
    const totals = await this.dataSource.query<
      { cash_expected: string; transfer_total: string }[]
    >(
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

    // Cerrar la sesión
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

    const balances =
      difference === 0 ? 'exact' : difference > 0 ? 'surplus' : 'shortage';

    return {
      session,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      difference,
      balances,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  UTILIDADES
  // ───────────────────────────────────────────────────────────────────────────

  private getToday(): string {
    // toISOString() devuelve UTC. Argentina es UTC-3, por lo que entre
    // las 21:00 y las 23:59 hora local, la fecha UTC ya es el día siguiente.
    // Esto causaría que getOrCreateActiveSession busque/cree una sesión con
    // fecha incorrecta, violando el UNIQUE constraint UQ_cash_session_date.
    // Se usa toLocaleDateString con la zona horaria correcta para obtener
    // siempre la fecha según el reloj local del negocio.
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  }
}
