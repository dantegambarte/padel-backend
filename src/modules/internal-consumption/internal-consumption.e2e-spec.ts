/**
 * E2E test: POST /internal-consumption
 *
 * Prerequisites:
 *   - Running PostgreSQL instance with migrations applied.
 *   - Environment variables set (DATABASE_URL, JWT_SECRET, etc.).
 *   - At least one Product and one Teacher seeded (see beforeAll).
 *
 * Run with:
 *   npm run test:e2e -- --testPathPatterns=internal-consumption.e2e-spec
 *
 * Nota: el `testRegex` por defecto de jest.config.js (`.*\.spec\.ts$`) no matchea
 * los archivos `*.e2e-spec.ts`, por eso hace falta el script `test:e2e`, que trae
 * su propio regex. El flag es `--testPathPatterns` (en plural) desde Jest 30.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { DataSource } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { Teacher } from '../teachers/entities/teacher.entity';
import { InternalConsumption } from './entities/internal-consumption.entity';

describe('POST /internal-consumption (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let adminUserId: string;
  let productId: string;
  let teacherId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts aplica este prefijo en el bootstrap real; el test debe replicarlo
    // o todas las requests pegan a rutas inexistentes.
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    ds = moduleFixture.get(DataSource);

    // Seed a product
    const product = ds.getRepository(Product).create({
      name: 'Gatorade E2E',
      costPrice: 500,
      salePrice: 800,
      stock: 20,
      minStock: 2,
    });
    const savedProduct = await ds.getRepository(Product).save(product);
    productId = savedProduct.id;

    // Seed a teacher
    const teacher = ds.getRepository(Teacher).create({
      fullName: 'Profesor E2E',
      phoneNumber: '5491100000000',
    });
    const savedTeacher = await ds.getRepository(Teacher).save(teacher);
    teacherId = savedTeacher.id;

    // Login as admin to get JWT
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: process.env.E2E_ADMIN_USER ?? 'admin',
        password: process.env.E2E_ADMIN_PASS ?? 'admin123',
      });

    adminToken = loginRes.body?.accessToken;
    adminUserId = loginRes.body?.user?.id;
  });

  afterAll(async () => {
    // Cleanup seeded data
    await ds.getRepository(InternalConsumption).delete({ productId });
    await ds.getRepository(Product).delete(productId);
    await ds.getRepository(Teacher).delete(teacherId);
    await app.close();
  });

  it('201 — creates staff consumption and decrements stock', async () => {
    const before = await ds.getRepository(Product).findOneBy({ id: productId });

    const res = await request(app.getHttpServer())
      .post('/api/v1/internal-consumption')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productId,
        quantity: 3,
        consumerType: 'staff',
        // El DTO exige userId cuando consumerType es staff (ver
        // CreateInternalConsumptionDto). Usamos el id del admin logueado.
        userId: adminUserId,
        date: '2026-04-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('staff_consumption');
    expect(res.body.quantity).toBe(3);

    const after = await ds.getRepository(Product).findOneBy({ id: productId });
    expect(after!.stock).toBe(before!.stock - 3);
  });

  it('201 — creates teacher consumption → pending_payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal-consumption')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productId,
        quantity: 1,
        consumerType: 'teacher',
        teacherId,
        date: '2026-04-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_payment');
    expect(res.body.teacherId).toBe(teacherId);
  });

  it('400 — rejects insufficient stock', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal-consumption')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productId,
        quantity: 99999,
        consumerType: 'staff',
        date: '2026-04-15',
      });

    expect(res.status).toBe(400);
  });

  it('401 — rejects unauthenticated request', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal-consumption')
      .send({ productId, quantity: 1, consumerType: 'staff', date: '2026-04-15' });

    expect(res.status).toBe(401);
  });
});
