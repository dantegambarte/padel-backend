/**
 * E2E test: POST /internal-consumption
 *
 * Prerequisites:
 *   - Running PostgreSQL instance with migrations applied.
 *   - Environment variables set (DATABASE_URL, JWT_SECRET, etc.).
 *   - At least one Product and one Teacher seeded (see beforeAll).
 *
 * Run with:
 *   npx jest --testPathPattern=internal-consumption.e2e-spec --runInBand
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
  let productId: string;
  let teacherId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
      .post('/auth/login')
      .send({
        username: process.env.E2E_ADMIN_USER ?? 'admin',
        password: process.env.E2E_ADMIN_PASS ?? 'admin123',
      });

    adminToken = loginRes.body?.access_token;
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
      .post('/internal-consumption')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productId,
        quantity: 3,
        consumerType: 'staff',
        userId: null, // nullable in this test
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
      .post('/internal-consumption')
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
      .post('/internal-consumption')
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
      .post('/internal-consumption')
      .send({ productId, quantity: 1, consumerType: 'staff', date: '2026-04-15' });

    expect(res.status).toBe(401);
  });
});
