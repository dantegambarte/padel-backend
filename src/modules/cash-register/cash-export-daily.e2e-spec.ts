/**
 * E2E test: GET /cash/export/daily
 *
 * Prerequisites: running PostgreSQL with the current schema and an admin user
 * (E2E_ADMIN_USER / E2E_ADMIN_PASS, default admin / admin123).
 *
 * Run with:
 *   pnpm run test:e2e -- --testPathPatterns=cash-export-daily.e2e-spec
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { CashSession, CashSessionStatus } from './entities/cash-session.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { Expense } from '../expenses/entities/expense.entity';

const DATE = '2001-02-03';

describe('GET /cash/export/daily (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let sessionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = moduleFixture.get(DataSource);

    const session = await ds.getRepository(CashSession).save(
      ds.getRepository(CashSession).create({
        date: DATE,
        status: CashSessionStatus.CLOSED,
        initialBalance: 100,
        cashCounted: 1400,
        closedAt: new Date(),
      }),
    );
    sessionId = session.id;

    await ds.getRepository(Transaction).save([
      {
        cashSessionId: sessionId,
        type: TransactionType.SALE,
        concept: 'E2E sale',
        amountCash: 1000,
        amountTransfer: 300,
      },
      {
        cashSessionId: sessionId,
        type: TransactionType.BOOKING,
        concept: 'E2E booking',
        amountCash: 500,
        amountTransfer: 0,
      },
    ]);
    const expenses = ds.getRepository(Expense);
    await expenses.save({
      cashSessionId: sessionId,
      amount: 200,
      description: 'E2E expense',
      date: DATE,
    });
    const deleted = await expenses.save({
      cashSessionId: sessionId,
      amount: 999,
      description: 'E2E deleted expense',
      date: DATE,
    });
    await expenses.softDelete(deleted.id);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: process.env.E2E_ADMIN_USER ?? 'admin',
        password: process.env.E2E_ADMIN_PASS ?? 'admin123',
      });
    adminToken = loginRes.body?.accessToken;
  });

  afterAll(async () => {
    await ds.query('DELETE FROM expenses WHERE cash_session_id = $1', [sessionId]);
    await ds.query('DELETE FROM transactions WHERE cash_session_id = $1', [sessionId]);
    await ds.query('DELETE FROM cash_sessions WHERE id = $1', [sessionId]);
    await app.close();
  });

  it('returns the Z workbook with cash income from transactions and expenses from the expenses table', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/cash/export/daily?date=${DATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Resumen del Día')!;
    const values = new Map<string, string>();
    sheet.eachRow((row) => {
      const label = row.getCell(1).text;
      // Summary rows come first; per-shift detail repeats some labels.
      if (!values.has(label)) values.set(label, row.getCell(2).text);
    });

    expect(values.get('Cantidad de turnos')).toBe('1');
    expect(values.get('+ Ingresos en Efectivo')).toBe('$ 1.500,00');
    expect(values.get('- Egresos en Efectivo (gastos)')).toBe('$ 200,00');
    expect(values.get('= Efectivo esperado (sistema)')).toBe('$ 1.400,00');
    expect(values.get('Transferencias totales')).toBe('$ 300,00');
  });
});
