/**
 * Seed de historial de caja multi-día para desarrollo y demos.
 *
 * Ejecutar con:
 *   npm run seed:cash
 *
 * Prerequisitos:
 *   BD accesible y .env configurado. Si la BD está vacía el script
 *   crea los recursos mínimos (2 usuarios, 1 cancha, 2 productos).
 *
 * Escenario generado (últimas 3 jornadas comerciales):
 *
 *   Día -3   Turno Mañana  CLOSED 09:00–18:00   ef.$11.000  Δ +$200  (sobrante)
 *            Turno Noche   CLOSED 18:00–01:00   ef.$9.000   Δ -$300  (faltante)
 *
 *   Día -2   Turno Mañana  CLOSED 09:00–18:00   ef.$12.500  Δ  $0    (cuadra)
 *            Turno Noche   CLOSED 18:00–01:00   ef.$10.300  Δ -$300  (faltante)
 *
 *   Día -1   Turno Mañana  CLOSED 09:00–18:00   ef.$12.500  Δ +$200  (sobrante)
 *            Turno Noche   OPEN   18:00–en curso ef.$9.800   sin cierre
 *
 * FK-safe: sesiones se insertan primero via raw SQL (para controlar
 * opened_at, un @CreateDateColumn). El resto via repositorios TypeORM,
 * todo dentro de una única transacción atómica por día.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

import { User, UserRole } from '../modules/users/entities/user.entity';
import { Court } from '../modules/courts/entities/court.entity';
import { ProductCategory } from '../modules/products/entities/product-category.entity';
import { Product } from '../modules/products/entities/product.entity';
import { Booking, BookingStatus, PriceType } from '../modules/bookings/entities/booking.entity';
import { BookingPayment } from '../modules/bookings/entities/booking-payment.entity';
import {
  CashSession,
  CashSessionStatus,
} from '../modules/cash-register/entities/cash-session.entity';
import { Transaction, TransactionType } from '../modules/cash-register/entities/transaction.entity';
import { Sale } from '../modules/pos/entities/sale.entity';
import { SaleItem } from '../modules/pos/entities/sale-item.entity';

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'padel_user',
  password: process.env.DB_PASSWORD || 'padel_secret',
  database: process.env.DB_DATABASE || 'padelsys',
  synchronize: false,
  logging: false,
  entities: [
    User,
    Court,
    ProductCategory,
    Product,
    Booking,
    BookingPayment,
    CashSession,
    Transaction,
    Sale,
    SaleItem,
  ],
});

/** YYYY-MM-DD para hoy + offsetDays (calendario local). */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** ISO 8601 con offset Argentina -03:00 para INSERT raw de timestamps. */
function argTs(dateStr: string, hh: number, mm: number): string {
  return `${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000-03:00`;
}

interface SaleSpec {
  cash: number;
  tr: number;
  customer: string | null;
}

interface BookingSpec {
  hour: string;
  client: string;
  priceAmount: number;
  cash: number;
  tr: number;
}

interface ShiftSpec {
  user: 'user1' | 'user2';
  openHh: number;
  openMm: number;
  closeDate: string | null;
  closeHh: number | null;
  closeMm: number | null;
  sales: SaleSpec[];
  bookings: BookingSpec[];
  cashCounted: number | null;
  difference: number | null;
  notes: string;
}

interface DaySpec {
  date: string;
  morning: ShiftSpec;
  night: ShiftSpec;
}

async function seedCash(): Promise<void> {
  await dataSource.initialize();
  console.log('📦 Conectado a la base de datos...\n');

  const userRepo = dataSource.getRepository(User);
  const courtRepo = dataSource.getRepository(Court);
  const productRepo = dataSource.getRepository(Product);
  const catRepo = dataSource.getRepository(ProductCategory);

  let allUsers = await userRepo.find({
    where: { isActive: true },
    order: { createdAt: 'ASC' },
  });

  if (allUsers.length === 0) {
    console.log('⚙️  No hay usuarios activos. Creando usuarios de demo...');
    const [h1, h2] = await Promise.all([
      bcrypt.hash('gustavo123', 10),
      bcrypt.hash('guada123', 10),
    ]);
    allUsers = await userRepo.save([
      {
        username: 'gustavo',
        fullName: 'Gustavo Sosa',
        passwordHash: h1,
        role: UserRole.EMPLOYEE,
        isActive: true,
      },
      {
        username: 'guada',
        fullName: 'Guadalupe García',
        passwordHash: h2,
        role: UserRole.EMPLOYEE,
        isActive: true,
      },
    ]);
    console.log('✅ Usuarios creados: gustavo / guada');
  } else {
    console.log(`⏭️  Usando ${allUsers.length} usuario(s) existente(s)`);
  }

  const findUser = (kw: string) =>
    allUsers.find((u) => u.fullName.toLowerCase().includes(kw.toLowerCase()));
  const user1 = findUser('gustavo') ?? allUsers[0];
  const user2 = findUser('guada') ?? (allUsers.length > 1 ? allUsers[1] : allUsers[0]);
  console.log(`   👤 Turno Mañana → ${user1.fullName}`);
  console.log(`   👤 Turno Noche  → ${user2.fullName}\n`);

  let courts = await courtRepo.find({ where: { isActive: true }, order: { createdAt: 'ASC' } });
  if (courts.length === 0) {
    courts = await courtRepo.save([
      { name: 'Cancha 1', description: 'Cancha principal cubierta', isActive: true },
    ]);
    console.log('✅ Cancha creada: Cancha 1');
  } else {
    console.log(`⏭️  Cancha: ${courts[0].name} (existente)`);
  }
  const court = courts[0];

  let products = await productRepo.find({ where: { isActive: true }, order: { createdAt: 'ASC' } });
  if (products.length === 0) {
    let cat = await catRepo.findOne({ where: { name: 'Bebidas' } });
    if (!cat) cat = await catRepo.save({ name: 'Bebidas' });
    products = await productRepo.save([
      {
        name: 'Agua Mineral 500ml',
        category: cat,
        categoryId: cat.id,
        costPrice: 150,
        salePrice: 300,
        stock: 48,
        minStock: 10,
        isFeatured: true,
        isActive: true,
      },
      {
        name: 'Gatorade',
        category: cat,
        categoryId: cat.id,
        costPrice: 250,
        salePrice: 450,
        stock: 30,
        minStock: 10,
        isFeatured: true,
        isActive: true,
      },
    ]);
    console.log('✅ Productos creados: Agua Mineral / Gatorade');
  } else {
    console.log(`⏭️  Usando ${products.length} producto(s) existente(s)`);
  }
  const p1 = products[0];
  const p2 = products.length > 1 ? products[1] : products[0];

  const D3 = dateOffset(-3);
  const D2 = dateOffset(-2);
  const D1 = dateOffset(-1);

  /**
   * Tabla de escenarios.
   * cashExpected = SUM(sales[].cash + bookings[].cash)
   * difference   = cashCounted - cashExpected
   *
   * Día -3:  Mañana +$200 sobrante  |  Noche -$300 faltante
   * Día -2:  Mañana Δ $0 cuadra     |  Noche -$300 faltante
   * Día -1:  Mañana +$200 sobrante  |  Noche OPEN (sin cierre)
   */
  const days: DaySpec[] = [
    {
      date: D3,
      morning: {
        user: 'user1',
        openHh: 9,
        openMm: 0,
        closeDate: D3,
        closeHh: 18,
        closeMm: 0,
        sales: [
          { cash: 2000, tr: 0, customer: 'Rodríguez' },
          { cash: 1500, tr: 0, customer: null },
          { cash: 0, tr: 2500, customer: 'Vega' },
        ],
        bookings: [
          { hour: '09:00', client: 'García', priceAmount: 7500, cash: 7500, tr: 0 },
          { hour: '12:00', client: 'Herrera', priceAmount: 4500, cash: 0, tr: 4500 },
        ],
        cashCounted: 11200,
        difference: 200,
        notes: 'Turno mañana — seed:cash',
      },
      night: {
        user: 'user2',
        openHh: 18,
        openMm: 0,
        closeDate: D2,
        closeHh: 1,
        closeMm: 0,
        sales: [
          { cash: 1500, tr: 0, customer: 'Molina' },
          { cash: 0, tr: 2500, customer: 'Ponce' },
        ],
        bookings: [{ hour: '19:00', client: 'Ibáñez', priceAmount: 7500, cash: 7500, tr: 0 }],
        cashCounted: 8700,
        difference: -300,
        notes: 'Turno noche — seed:cash',
      },
    },

    {
      date: D2,
      morning: {
        user: 'user1',
        openHh: 9,
        openMm: 0,
        closeDate: D2,
        closeHh: 18,
        closeMm: 0,
        sales: [
          { cash: 2500, tr: 0, customer: 'Soto' },
          { cash: 2000, tr: 0, customer: null },
          { cash: 0, tr: 3000, customer: 'Blanco' },
        ],
        bookings: [
          { hour: '09:00', client: 'Morales', priceAmount: 8000, cash: 8000, tr: 0 },
          { hour: '12:00', client: 'Castro', priceAmount: 5000, cash: 0, tr: 5000 },
        ],
        cashCounted: 12500,
        difference: 0,
        notes: 'Turno mañana — seed:cash',
      },
      night: {
        user: 'user2',
        openHh: 18,
        openMm: 0,
        closeDate: D1,
        closeHh: 1,
        closeMm: 0,
        sales: [
          { cash: 1800, tr: 0, customer: 'Fuentes' },
          { cash: 0, tr: 2000, customer: 'Paredes' },
        ],
        bookings: [{ hour: '19:00', client: 'Romero', priceAmount: 8500, cash: 8500, tr: 0 }],
        cashCounted: 10000,
        difference: -300,
        notes: 'Turno noche — seed:cash',
      },
    },

    {
      date: D1,
      morning: {
        user: 'user1',
        openHh: 9,
        openMm: 0,
        closeDate: D1,
        closeHh: 18,
        closeMm: 0,
        sales: [
          { cash: 3000, tr: 0, customer: 'Gutiérrez' },
          { cash: 1500, tr: 0, customer: null },
          { cash: 0, tr: 3500, customer: 'Jiménez' },
        ],
        bookings: [
          { hour: '09:00', client: 'Peña', priceAmount: 8000, cash: 8000, tr: 0 },
          { hour: '12:00', client: 'Ramírez', priceAmount: 5000, cash: 0, tr: 5000 },
        ],
        cashCounted: 12700,
        difference: 200,
        notes: 'Turno mañana — seed:cash',
      },
      night: {
        user: 'user2',
        openHh: 18,
        openMm: 0,
        closeDate: null,
        closeHh: null,
        closeMm: null,
        sales: [
          { cash: 1800, tr: 0, customer: 'Torres' },
          { cash: 0, tr: 2200, customer: 'Ruiz' },
        ],
        bookings: [{ hour: '19:00', client: 'Fernández', priceAmount: 8000, cash: 8000, tr: 0 }],
        cashCounted: null,
        difference: null,
        notes: 'Turno noche — seed:cash',
      },
    },
  ];

  const sessionRepo = dataSource.getRepository(CashSession);
  const txRepo = dataSource.getRepository(Transaction);
  const saleRepo = dataSource.getRepository(Sale);

  console.log('🧹 Limpiando datos previos...');

  const openSessions = await sessionRepo.find({ where: { status: CashSessionStatus.OPEN } });
  for (const s of openSessions) {
    await txRepo.delete({ cashSessionId: s.id });
    await saleRepo.delete({ cashSessionId: s.id });
  }
  if (openSessions.length) {
    await sessionRepo.remove(openSessions);
    console.log(`   🗑  ${openSessions.length} sesión(es) abierta(s) eliminada(s)`);
  }

  const seedDates = days.map((d) => d.date);
  for (const date of seedDates) {
    const existing = await sessionRepo.find({ where: { date } });
    for (const s of existing) {
      await txRepo.delete({ cashSessionId: s.id });
      await saleRepo.delete({ cashSessionId: s.id });
    }
    if (existing.length) {
      await sessionRepo.remove(existing);
      console.log(`   🗑  ${existing.length} sesión(es) del ${date} eliminada(s)`);
    }
  }

  const qr = dataSource.createQueryRunner();
  await qr.connect();

  try {
    console.log('\n🔄 Iniciando transacción...');
    await qr.startTransaction();

    const insertSession = async (spec: ShiftSpec, date: string, user: User): Promise<string> => {
      const isOpen = spec.cashCounted === null;

      if (isOpen) {
        const [row] = await qr.query(
          `INSERT INTO cash_sessions
             (date, status, opened_by_user_id, closed_by_user_id,
              initial_balance, cash_counted, difference, notes, opened_at, closed_at)
           VALUES ($1, 'open', $2, NULL, 500, NULL, NULL, $3, $4, NULL)
           RETURNING id`,
          [date, user.id, spec.notes, argTs(date, spec.openHh, spec.openMm)],
        );
        return row.id as string;
      }

      const [row] = await qr.query(
        `INSERT INTO cash_sessions
           (date, status, opened_by_user_id, closed_by_user_id,
            initial_balance, cash_counted, difference, notes, opened_at, closed_at)
         VALUES ($1, 'closed', $2, $2, 500, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          date,
          user.id,
          spec.cashCounted,
          spec.difference,
          spec.notes,
          argTs(date, spec.openHh, spec.openMm),
          argTs(spec.closeDate!, spec.closeHh!, spec.closeMm!),
        ],
      );
      return row.id as string;
    };

    const insertSale = async (sessionId: string, user: User, s: SaleSpec): Promise<Sale> => {
      const sale = await qr.manager.save(Sale, {
        cashSessionId: sessionId,
        createdByUserId: user.id,
        amountCash: s.cash,
        amountTransfer: s.tr,
        total: s.cash + s.tr,
        customerName: s.customer,
      } as Partial<Sale>);

      await qr.manager.save(SaleItem, {
        saleId: sale.id,
        productId: p1.id,
        quantity: 1,
        unitPrice: p1.salePrice,
      } as Partial<SaleItem>);
      if (p2.id !== p1.id) {
        await qr.manager.save(SaleItem, {
          saleId: sale.id,
          productId: p2.id,
          quantity: 1,
          unitPrice: p2.salePrice,
        } as Partial<SaleItem>);
      }

      return sale;
    };

    const insertTx = (
      sessionId: string,
      user: User,
      type: TransactionType,
      refId: string,
      concept: string,
      cash: number,
      tr: number,
    ) =>
      qr.manager.save(Transaction, {
        cashSessionId: sessionId,
        createdByUserId: user.id,
        type,
        referenceId: refId,
        concept,
        amountCash: cash,
        amountTransfer: tr,
      } as Partial<Transaction>);

    /** Crea el Booking si no existe; siempre devuelve su ID. */
    const upsertBooking = async (b: BookingSpec, date: string, userId: string): Promise<string> => {
      const found = await qr.manager.findOne(Booking, {
        where: { courtId: court.id, date, hour: b.hour },
      });
      if (found) return found.id;

      const booking = await qr.manager.save(Booking, {
        courtId: court.id,
        date,
        hour: b.hour,
        status: BookingStatus.COMPLETED,
        clientName: b.client,
        priceType: PriceType.STANDARD,
        priceAmount: b.priceAmount,
        durationMinutes: 60,
        createdByUserId: userId,
      } as Partial<Booking>);

      await qr.manager.save(BookingPayment, {
        bookingId: booking.id,
        amountCash: b.cash,
        amountTransfer: b.tr,
      } as Partial<BookingPayment>);

      return booking.id;
    };

    for (const day of days) {
      console.log(`\n📅 Procesando jornada ${day.date}:`);

      for (const [label, spec] of [
        ['Mañana', day.morning],
        ['Noche', day.night],
      ] as [string, ShiftSpec][]) {
        const user = spec.user === 'user1' ? user1 : user2;
        const sId = await insertSession(spec, day.date, user);
        const state = spec.cashCounted === null ? 'OPEN' : 'CLOSED';

        console.log(`   [${label}] sesión ${state} → ${sId}`);

        for (const saleSpec of spec.sales) {
          const sale = await insertSale(sId, user, saleSpec);
          const customerLabel = saleSpec.customer ? ` (${saleSpec.customer})` : '';
          await insertTx(
            sId,
            user,
            TransactionType.SALE,
            sale.id,
            `Venta cantina — 2 unidades${customerLabel}`,
            saleSpec.cash,
            saleSpec.tr,
          );
        }

        for (const bSpec of spec.bookings) {
          const bId = await upsertBooking(bSpec, day.date, user.id);
          await insertTx(
            sId,
            user,
            TransactionType.BOOKING,
            bId,
            `${court.name} · ${bSpec.hour}hs — ${bSpec.client}`,
            bSpec.cash,
            bSpec.tr,
          );
        }

        const cashExp =
          spec.sales.reduce((s, x) => s + x.cash, 0) +
          spec.bookings.reduce((s, x) => s + x.cash, 0);
        const trExp =
          spec.sales.reduce((s, x) => s + x.tr, 0) + spec.bookings.reduce((s, x) => s + x.tr, 0);

        if (spec.cashCounted !== null) {
          const sign =
            spec.difference === 0
              ? 'Δ $0 (cuadra)'
              : `Δ ${spec.difference! > 0 ? '+' : ''}$${spec.difference}`;
          console.log(
            `         ef.$${cashExp} | tr.$${trExp} | contado $${spec.cashCounted} | ${sign}`,
          );
        } else {
          console.log(`         ef.$${cashExp} | tr.$${trExp} | en curso (sin cierre)`);
        }
      }
    }

    await qr.commitTransaction();
    console.log('\n✅ Transacción confirmada.\n');

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║               SEED:CASH — HISTORIAL GENERADO                ║');
    console.log('╠══════╦═══════════╦════════╦══════════╦═════════╦════════════╣');
    console.log('║ Día  ║ Turno     ║ Estado ║ Ef.esp.  ║ Contado ║ Diferencia ║');
    console.log('╠══════╬═══════════╬════════╬══════════╬═════════╬════════════╣');

    for (const day of days) {
      for (const [label, spec] of [
        ['Mañana', day.morning],
        ['Noche', day.night],
      ] as [string, ShiftSpec][]) {
        const cashExp =
          spec.sales.reduce((s, x) => s + x.cash, 0) +
          spec.bookings.reduce((s, x) => s + x.cash, 0);
        const estado = spec.cashCounted === null ? 'OPEN  ' : 'CLOSED';
        const contado = spec.cashCounted === null ? '  —   ' : `$${spec.cashCounted}`;
        const diff =
          spec.difference === null
            ? '    —     '
            : spec.difference === 0
              ? '   $0     '
              : spec.difference > 0
                ? `  +$${spec.difference}  `
                : `  -$${Math.abs(spec.difference)}  `;
        console.log(
          `║ ${day.date.slice(5)} ║ ${label.padEnd(9)} ║ ${estado} ║ $${String(cashExp).padEnd(7)} ║ ${contado.padEnd(7)} ║ ${diff.padEnd(10)} ║`,
        );
      }
    }

    console.log('╚══════╩═══════════╩════════╩══════════╩═════════╩════════════╝');
    console.log('');
    console.log(`👉  En el Historial Diario consulta: ${D3} / ${D2} / ${D1}`);
    console.log(`    El DatePicker iniciará en ${D1} (jornada comercial activa).\n`);
  } catch (err) {
    if (qr.isTransactionActive) {
      await qr.rollbackTransaction();
      console.error('\n❌ Transacción revertida.');
    }
    console.error('❌ Error durante el seed:', err);
    process.exit(1);
  } finally {
    if (!qr.isReleased) await qr.release();
    await dataSource.destroy();
  }
}

seedCash();
