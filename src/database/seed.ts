/**
 * Seed de datos para desarrollo/testing.
 * Ejecutar con: npm run seed
 *
 * Crea:
 *  - 1 Admin + 2 Empleados
 *  - 3 Canchas
 *  - 5 Categorías + 8 Productos
 *  - Configuración del sistema
 *  - Reservas (pasadas, hoy, futuras) con distintos estados
 *  - Sesiones de caja (últimos 7 días cerradas, hoy abierta)
 *  - Ventas POS
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
import { SystemConfig } from '../modules/system-config/entities/system-config.entity';
import { Booking, BookingStatus, PriceType } from '../modules/bookings/entities/booking.entity';
import { BookingItem } from '../modules/bookings/entities/booking-item.entity';
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
  synchronize: true,
  logging: false,
  entities: [
    User,
    Court,
    ProductCategory,
    Product,
    SystemConfig,
    Booking,
    BookingItem,
    BookingPayment,
    CashSession,
    Transaction,
    Sale,
    SaleItem,
  ],
});

/** Retorna "YYYY-MM-DD" para hoy + offset de días */
function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

async function seed() {
  await dataSource.initialize();
  console.log('📦 Conectado a la base de datos...');

  const userRepo = dataSource.getRepository(User);
  let adminUser: User;
  let employee1: User;
  let employee2: User;

  const existingAdmin = await userRepo.findOne({ where: { username: 'admin' } });

  if (!existingAdmin) {
    const adminHash = await bcrypt.hash('admin123', 10);
    const emp1Hash = await bcrypt.hash('empleado123', 10);
    const emp2Hash = await bcrypt.hash('lucia123', 10);

    [adminUser, employee1, employee2] = await userRepo.save([
      {
        username: 'admin',
        fullName: 'Administrador',
        passwordHash: adminHash,
        role: UserRole.ADMIN,
        isActive: true,
      },
      {
        username: 'empleado',
        fullName: 'Empleado Demo',
        passwordHash: emp1Hash,
        role: UserRole.EMPLOYEE,
        isActive: true,
      },
      {
        username: 'lucia',
        fullName: 'Lucía Martínez',
        passwordHash: emp2Hash,
        role: UserRole.EMPLOYEE,
        isActive: true,
      },
    ]);
    console.log('✅ Usuarios creados: admin / empleado / lucia');
  } else {
    adminUser = existingAdmin;
    employee1 = (await userRepo.findOne({ where: { username: 'empleado' } })) ?? existingAdmin;
    employee2 = (await userRepo.findOne({ where: { username: 'lucia' } })) ?? existingAdmin;
    if (!(await userRepo.findOne({ where: { username: 'lucia' } }))) {
      const emp2Hash = await bcrypt.hash('lucia123', 10);
      employee2 = await userRepo.save({
        username: 'lucia',
        fullName: 'Lucía Martínez',
        passwordHash: emp2Hash,
        role: UserRole.EMPLOYEE,
        isActive: true,
      });
    }
    console.log('⏭️  Usuarios ya existen, saltando...');
  }

  const courtRepo = dataSource.getRepository(Court);
  let courts: Court[];

  const courtCount = await courtRepo.count();
  if (courtCount === 0) {
    courts = await courtRepo.save([
      { name: 'Cancha 1', description: 'Cancha principal cubierta', isActive: true },
      { name: 'Cancha 2', description: 'Cancha descubierta', isActive: true },
      { name: 'Cancha 3', description: 'Cancha VIP cubierta', isActive: true },
    ]);
    console.log('✅ 3 Canchas creadas');
  } else {
    courts = await courtRepo.find();
    console.log('⏭️  Canchas ya existen, saltando...');
  }

  const categoryRepo = dataSource.getRepository(ProductCategory);
  let categories: Record<string, ProductCategory> = {};

  const categoryCount = await categoryRepo.count();
  if (categoryCount === 0) {
    const saved = await categoryRepo.save([
      { name: 'Bebidas' },
      { name: 'Accesorios' },
      { name: 'Indumentaria' },
      { name: 'Snacks' },
      { name: 'Equipamiento' },
    ]);
    saved.forEach((c) => (categories[c.name] = c));
    console.log('✅ 5 Categorías creadas');
  } else {
    const saved = await categoryRepo.find();
    saved.forEach((c) => (categories[c.name] = c));
    console.log('⏭️  Categorías ya existen, saltando...');
  }

  const productRepo = dataSource.getRepository(Product);
  let products: Record<string, Product> = {};

  const productCount = await productRepo.count();
  if (productCount === 0) {
    const saved = await productRepo.save([
      {
        name: 'Agua Mineral 500ml',
        category: categories['Bebidas'],
        costPrice: 150,
        salePrice: 300,
        stock: 48,
        minStock: 20,
        isFeatured: true,
        isActive: true,
      },
      {
        name: 'Pelotas Wilson',
        category: categories['Accesorios'],
        costPrice: 800,
        salePrice: 1200,
        stock: 25,
        minStock: 10,
        isFeatured: true,
        isActive: true,
      },
      {
        name: 'Gatorade',
        category: categories['Bebidas'],
        costPrice: 250,
        salePrice: 450,
        stock: 30,
        minStock: 15,
        isFeatured: true,
        isActive: true,
      },
      {
        name: 'Grip HEAD',
        category: categories['Accesorios'],
        costPrice: 350,
        salePrice: 600,
        stock: 15,
        minStock: 8,
        isFeatured: true,
        isActive: true,
      },
      {
        name: 'Muñequera Nike',
        category: categories['Indumentaria'],
        costPrice: 400,
        salePrice: 700,
        stock: 12,
        minStock: 5,
        isFeatured: false,
        isActive: true,
      },
      {
        name: 'Toalla Deportiva',
        category: categories['Indumentaria'],
        costPrice: 500,
        salePrice: 850,
        stock: 8,
        minStock: 5,
        isFeatured: false,
        isActive: true,
      },
      {
        name: 'Red Bull',
        category: categories['Bebidas'],
        costPrice: 300,
        salePrice: 550,
        stock: 20,
        minStock: 10,
        isFeatured: false,
        isActive: true,
      },
      {
        name: 'Barrita Energética',
        category: categories['Snacks'],
        costPrice: 200,
        salePrice: 350,
        stock: 35,
        minStock: 10,
        isFeatured: false,
        isActive: true,
      },
    ]);
    saved.forEach((p) => (products[p.name] = p));
    console.log('✅ 8 Productos creados');
  } else {
    const saved = await productRepo.find();
    saved.forEach((p) => (products[p.name] = p));
    console.log('⏭️  Productos ya existen, saltando...');
  }

  const configRepo = dataSource.getRepository(SystemConfig);
  const configCount = await configRepo.count();

  if (configCount === 0) {
    await configRepo.save([
      {
        key: 'precio_estandar',
        value: '3000',
        description: 'Precio por hora de cancha - Tarifa estándar',
      },
      {
        key: 'precio_profesor',
        value: '2500',
        description: 'Precio por hora de cancha - Tarifa profesor',
      },
      {
        key: 'hora_apertura',
        value: '09:00',
        description: 'Horario de apertura del establecimiento',
      },
      { key: 'hora_cierre', value: '23:00', description: 'Horario de cierre del establecimiento' },
      {
        key: 'nombre_club',
        value: 'PadelSys',
        description: 'Nombre del club (aparece en el sistema)',
      },
      {
        key: 'duracion_turno_minutos',
        value: '60',
        description: 'Duración de cada turno en minutos',
      },
    ]);
    console.log('✅ Configuración del sistema creada');
  } else {
    console.log('⏭️  Configuración ya existe, saltando...');
  }

  const bookingRepo = dataSource.getRepository(Booking);
  const paymentRepo = dataSource.getRepository(BookingPayment);
  const bItemRepo = dataSource.getRepository(BookingItem);

  const bookingCount = await bookingRepo.count();
  if (bookingCount > 0) {
    console.log('⏭️  Reservas ya existen, saltando...');
  } else {
    const [c1, c2, c3] = courts;
    const agua = products['Agua Mineral 500ml'];
    const pelota = products['Pelotas Wilson'];
    const gato = products['Gatorade'];
    const grip = products['Grip HEAD'];

    interface BookingSeed {
      court: Court;
      date: string;
      hour: string;
      status: BookingStatus;
      clientName: string;
      priceType: PriceType;
      priceAmount: number;
      cash: number;
      transfer: number;
      items: { product: Product; qty: number }[];
    }

    const bookingsData: BookingSeed[] = [
      {
        court: c1,
        date: dateStr(-6),
        hour: '09:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Carlos Rodríguez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: agua, qty: 2 }],
      },
      {
        court: c2,
        date: dateStr(-6),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Martina López',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3600,
        items: [
          { product: gato, qty: 2 },
          { product: grip, qty: 1 },
        ],
      },
      {
        court: c3,
        date: dateStr(-6),
        hour: '11:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Prof. Gustavo Sosa',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(-6),
        hour: '17:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Diego Fernández',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 1500,
        items: [{ product: pelota, qty: 1 }],
      },
      {
        court: c2,
        date: dateStr(-6),
        hour: '19:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Ana García',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [],
      },

      {
        court: c1,
        date: dateStr(-5),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Roberto Silva',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: agua, qty: 4 }],
      },
      {
        court: c2,
        date: dateStr(-5),
        hour: '11:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Valeria Torres',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3000,
        items: [],
      },
      {
        court: c3,
        date: dateStr(-5),
        hour: '15:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Prof. Laura Ruiz',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [{ product: gato, qty: 1 }],
      },
      {
        court: c1,
        date: dateStr(-5),
        hour: '18:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Pablo Méndez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(-5),
        hour: '20:00',
        status: BookingStatus.CANCELLED,
        clientName: 'Sofía Herrera',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },

      {
        court: c1,
        date: dateStr(-4),
        hour: '09:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Javier Molina',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [
          { product: pelota, qty: 2 },
          { product: agua, qty: 2 },
        ],
      },
      {
        court: c2,
        date: dateStr(-4),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Camila Reyes',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3300,
        items: [{ product: grip, qty: 1 }],
      },
      {
        court: c3,
        date: dateStr(-4),
        hour: '16:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Prof. Marco Díaz',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(-4),
        hour: '19:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Florencia Castro',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: gato, qty: 1 }],
      },
      {
        court: c2,
        date: dateStr(-4),
        hour: '21:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Nicolás Romero',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 1500,
        items: [],
      },

      {
        court: c1,
        date: dateStr(-3),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Luciana Vega',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(-3),
        hour: '11:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Ezequiel Morales',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3450,
        items: [
          { product: agua, qty: 3 },
          { product: gato, qty: 1 },
        ],
      },
      {
        court: c3,
        date: dateStr(-3),
        hour: '14:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Prof. Ana Suárez',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(-3),
        hour: '17:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Tomás Blanco',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: pelota, qty: 1 }],
      },
      {
        court: c2,
        date: dateStr(-3),
        hour: '20:00',
        status: BookingStatus.CANCELLED,
        clientName: 'Emilia Paredes',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },

      {
        court: c1,
        date: dateStr(-2),
        hour: '09:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Gabriel Torres',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: agua, qty: 2 }],
      },
      {
        court: c2,
        date: dateStr(-2),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Valentina Cruz',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3000,
        items: [],
      },
      {
        court: c3,
        date: dateStr(-2),
        hour: '15:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Prof. Diego León',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [{ product: gato, qty: 2 }],
      },
      {
        court: c1,
        date: dateStr(-2),
        hour: '18:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Ignacio Medina',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(-2),
        hour: '19:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Pilar Ortega',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 1800,
        items: [
          { product: grip, qty: 1 },
          { product: agua, qty: 1 },
        ],
      },

      {
        court: c1,
        date: dateStr(-1),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Martín Gutiérrez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [
          { product: agua, qty: 2 },
          { product: gato, qty: 1 },
        ],
      },
      {
        court: c2,
        date: dateStr(-1),
        hour: '11:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Carla Jiménez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3000,
        items: [],
      },
      {
        court: c3,
        date: dateStr(-1),
        hour: '14:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Prof. Sandra Ríos',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(-1),
        hour: '17:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Luis Peña',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: pelota, qty: 1 }],
      },
      {
        court: c2,
        date: dateStr(-1),
        hour: '19:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Julia Ramírez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(-1),
        hour: '20:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Andrés Mora',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 1500,
        items: [{ product: gato, qty: 1 }],
      },

      {
        court: c1,
        date: dateStr(0),
        hour: '09:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Pedro Alvarado',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [{ product: agua, qty: 2 }],
      },
      {
        court: c2,
        date: dateStr(0),
        hour: '10:00',
        status: BookingStatus.COMPLETED,
        clientName: 'Rosa Castillo',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3300,
        items: [{ product: grip, qty: 1 }],
      },
      {
        court: c3,
        date: dateStr(0),
        hour: '11:00',
        status: BookingStatus.PLAYING,
        clientName: 'Prof. Pablo Vidal',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(0),
        hour: '12:00',
        status: BookingStatus.PLAYING,
        clientName: 'Hernán Soto',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 3000,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(0),
        hour: '14:00',
        status: BookingStatus.BOOKED,
        clientName: 'Gabriela Núñez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(0),
        hour: '15:00',
        status: BookingStatus.BOOKED,
        clientName: 'Fernando Acosta',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(0),
        hour: '16:00',
        status: BookingStatus.BOOKED,
        clientName: 'Carolina Vera',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 3000,
        items: [],
      },
      {
        court: c2,
        date: dateStr(0),
        hour: '17:00',
        status: BookingStatus.BOOKED,
        clientName: 'Sebastián Fuentes',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(0),
        hour: '18:00',
        status: BookingStatus.BOOKED,
        clientName: 'Natalia Espinoza',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(0),
        hour: '19:00',
        status: BookingStatus.BOOKED,
        clientName: 'Oscar Delgado',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(0),
        hour: '20:00',
        status: BookingStatus.BOOKED,
        clientName: 'Isabel Vargas',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },

      {
        court: c1,
        date: dateStr(1),
        hour: '09:00',
        status: BookingStatus.BOOKED,
        clientName: 'Rodrigo Ponce',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(1),
        hour: '10:00',
        status: BookingStatus.BOOKED,
        clientName: 'Claudia Ibáñez',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(1),
        hour: '11:00',
        status: BookingStatus.BOOKED,
        clientName: 'Prof. Ramón Tapia',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
      {
        court: c1,
        date: dateStr(1),
        hour: '15:00',
        status: BookingStatus.BOOKED,
        clientName: 'Miriam Salas',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(1),
        hour: '17:00',
        status: BookingStatus.BOOKED,
        clientName: 'Armando Flores',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(1),
        hour: '19:00',
        status: BookingStatus.BOOKED,
        clientName: 'Patricia Ramos',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },

      {
        court: c1,
        date: dateStr(2),
        hour: '10:00',
        status: BookingStatus.BOOKED,
        clientName: 'Víctor Navarro',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(2),
        hour: '14:00',
        status: BookingStatus.BOOKED,
        clientName: 'Elena Carrillo',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(2),
        hour: '18:00',
        status: BookingStatus.BOOKED,
        clientName: 'Miguel Herrera',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 0,
        transfer: 0,
        items: [],
      },

      {
        court: c1,
        date: dateStr(3),
        hour: '09:00',
        status: BookingStatus.BOOKED,
        clientName: 'Silvia Campos',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 1500,
        transfer: 0,
        items: [],
      },
      {
        court: c2,
        date: dateStr(3),
        hour: '11:00',
        status: BookingStatus.BOOKED,
        clientName: 'Hugo Palacios',
        priceType: PriceType.STANDARD,
        priceAmount: 3000,
        cash: 0,
        transfer: 0,
        items: [],
      },
      {
        court: c3,
        date: dateStr(3),
        hour: '16:00',
        status: BookingStatus.BOOKED,
        clientName: 'Prof. Irene Lozano',
        priceType: PriceType.PROFESSOR,
        priceAmount: 2500,
        cash: 2500,
        transfer: 0,
        items: [],
      },
    ];

    for (const bd of bookingsData) {
      const booking = await bookingRepo.save({
        court: bd.court,
        courtId: bd.court.id,
        date: bd.date,
        hour: bd.hour,
        status: bd.status,
        clientName: bd.clientName,
        priceType: bd.priceType,
        priceAmount: bd.priceAmount,
        createdByUser: employee1,
        createdByUserId: employee1.id,
      });

      if (bd.status !== BookingStatus.CANCELLED) {
        await paymentRepo.save({
          booking,
          bookingId: booking.id,
          amountCash: bd.cash,
          amountTransfer: bd.transfer,
        });
      }

      for (const { product, qty } of bd.items) {
        await bItemRepo.save({
          booking,
          bookingId: booking.id,
          product,
          productId: product.id,
          quantity: qty,
          unitPrice: product.salePrice,
        });
      }
    }
    console.log(`✅ ${bookingsData.length} Reservas creadas (con pagos e items)`);
  }

  const sessionRepo = dataSource.getRepository(CashSession);
  const txRepo = dataSource.getRepository(Transaction);

  const sessionCount = await sessionRepo.count();
  if (sessionCount > 0) {
    console.log('⏭️  Sesiones de caja ya existen, saltando...');
  } else {
    for (let d = -6; d <= -1; d++) {
      const date = dateStr(d);

      const dayBookings = await bookingRepo.find({
        where: { date },
        relations: ['payment', 'items'],
      });
      const totalCash = dayBookings.reduce((s, b) => s + Number(b.payment?.amountCash ?? 0), 0);

      const session = await sessionRepo.save({
        date,
        status: CashSessionStatus.CLOSED,
        openedByUser: employee1,
        openedByUserId: employee1.id,
        closedByUser: adminUser,
        closedByUserId: adminUser.id,
        cashCounted: totalCash + Math.floor(Math.random() * 200 - 100),
        closedAt: new Date(`${date}T23:30:00`),
        notes: 'Cierre Z automático',
      });

      for (const booking of dayBookings) {
        if (booking.status === BookingStatus.CANCELLED || !booking.payment) continue;

        const itemsTotal = booking.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
        const totalAmount = Number(booking.priceAmount) + itemsTotal;

        await txRepo.save({
          cashSession: session,
          cashSessionId: session.id,
          type: TransactionType.BOOKING,
          referenceId: booking.id,
          concept: `Turno ${booking.court?.name ?? ''} - ${booking.hour}hs (${booking.clientName})`,
          amountCash: Number(booking.payment.amountCash),
          amountTransfer: Number(booking.payment.amountTransfer),
          createdByUser: employee1,
          createdByUserId: employee1.id,
        });
      }
    }

    const todaySession = await sessionRepo.save({
      date: dateStr(0),
      status: CashSessionStatus.OPEN,
      openedByUser: employee1,
      openedByUserId: employee1.id,
    });

    const todayBookings = await bookingRepo.find({
      where: { date: dateStr(0) },
      relations: ['payment', 'items', 'court'],
    });
    for (const booking of todayBookings) {
      if (booking.status === BookingStatus.CANCELLED || !booking.payment) continue;
      if (Number(booking.payment.amountCash) === 0 && Number(booking.payment.amountTransfer) === 0)
        continue;

      await txRepo.save({
        cashSession: todaySession,
        cashSessionId: todaySession.id,
        type: TransactionType.BOOKING,
        referenceId: booking.id,
        concept: `Turno ${booking.court?.name ?? ''} - ${booking.hour}hs (${booking.clientName})`,
        amountCash: Number(booking.payment.amountCash),
        amountTransfer: Number(booking.payment.amountTransfer),
        createdByUser: employee1,
        createdByUserId: employee1.id,
      });
    }

    console.log('✅ Sesiones de caja creadas (6 cerradas + 1 abierta hoy)');

    const saleRepo = dataSource.getRepository(Sale);
    const sItemRepo = dataSource.getRepository(SaleItem);

    const pastSessions = await sessionRepo.find({
      where: { status: CashSessionStatus.CLOSED },
      order: { date: 'ASC' },
    });
    const salesData = [
      {
        session: pastSessions[0],
        items: [
          { product: products['Agua Mineral 500ml'], qty: 3 },
          { product: products['Barrita Energética'], qty: 2 },
        ],
        cash: 900,
        transfer: 700,
      },
      {
        session: pastSessions[0],
        items: [{ product: products['Red Bull'], qty: 2 }],
        cash: 1100,
        transfer: 0,
      },
      {
        session: pastSessions[1],
        items: [
          { product: products['Gatorade'], qty: 4 },
          { product: products['Agua Mineral 500ml'], qty: 2 },
        ],
        cash: 2400,
        transfer: 0,
      },
      {
        session: pastSessions[1],
        items: [{ product: products['Grip HEAD'], qty: 2 }],
        cash: 0,
        transfer: 1200,
      },
      {
        session: pastSessions[2],
        items: [
          { product: products['Pelotas Wilson'], qty: 1 },
          { product: products['Agua Mineral 500ml'], qty: 2 },
        ],
        cash: 1800,
        transfer: 0,
      },
      {
        session: pastSessions[2],
        items: [
          { product: products['Toalla Deportiva'], qty: 1 },
          { product: products['Muñequera Nike'], qty: 1 },
        ],
        cash: 0,
        transfer: 1550,
      },
      {
        session: pastSessions[3],
        items: [
          { product: products['Gatorade'], qty: 3 },
          { product: products['Red Bull'], qty: 1 },
        ],
        cash: 1900,
        transfer: 0,
      },
      {
        session: pastSessions[3],
        items: [{ product: products['Barrita Energética'], qty: 5 }],
        cash: 1750,
        transfer: 0,
      },
      {
        session: pastSessions[4],
        items: [
          { product: products['Agua Mineral 500ml'], qty: 6 },
          { product: products['Gatorade'], qty: 2 },
        ],
        cash: 2700,
        transfer: 0,
      },
      {
        session: pastSessions[4],
        items: [
          { product: products['Grip HEAD'], qty: 1 },
          { product: products['Pelotas Wilson'], qty: 2 },
        ],
        cash: 0,
        transfer: 3000,
      },
      {
        session: pastSessions[5],
        items: [
          { product: products['Red Bull'], qty: 3 },
          { product: products['Barrita Energética'], qty: 2 },
        ],
        cash: 2350,
        transfer: 0,
      },
      {
        session: pastSessions[5],
        items: [
          { product: products['Agua Mineral 500ml'], qty: 4 },
          { product: products['Gatorade'], qty: 1 },
        ],
        cash: 1650,
        transfer: 0,
      },
    ];

    for (const sd of salesData) {
      const itemsTotal = sd.items.reduce((s, i) => s + i.product.salePrice * i.qty, 0);
      const sale = await saleRepo.save({
        cashSession: sd.session,
        cashSessionId: sd.session.id,
        createdByUser: employee2,
        createdByUserId: employee2.id,
        amountCash: sd.cash,
        amountTransfer: sd.transfer,
        total: itemsTotal,
      });

      for (const { product, qty } of sd.items) {
        await sItemRepo.save({
          sale,
          saleId: sale.id,
          product,
          productId: product.id,
          quantity: qty,
          unitPrice: product.salePrice,
        });
      }

      await txRepo.save({
        cashSession: sd.session,
        cashSessionId: sd.session.id,
        type: TransactionType.SALE,
        referenceId: sale.id,
        concept: `Venta cantina - ${sd.items.length} producto(s)`,
        amountCash: sd.cash,
        amountTransfer: sd.transfer,
        createdByUser: employee2,
        createdByUserId: employee2.id,
      });
    }

    for (const sd of [
      {
        items: [
          { product: products['Agua Mineral 500ml'], qty: 2 },
          { product: products['Gatorade'], qty: 1 },
        ],
        cash: 1050,
        transfer: 0,
      },
      { items: [{ product: products['Grip HEAD'], qty: 1 }], cash: 0, transfer: 600 },
    ]) {
      const itemsTotal = sd.items.reduce((s, i) => s + i.product.salePrice * i.qty, 0);
      const sale = await saleRepo.save({
        cashSession: todaySession,
        cashSessionId: todaySession.id,
        createdByUser: employee1,
        createdByUserId: employee1.id,
        amountCash: sd.cash,
        amountTransfer: sd.transfer,
        total: itemsTotal,
      });

      for (const { product, qty } of sd.items) {
        await sItemRepo.save({
          sale,
          saleId: sale.id,
          product,
          productId: product.id,
          quantity: qty,
          unitPrice: product.salePrice,
        });
      }

      await txRepo.save({
        cashSession: todaySession,
        cashSessionId: todaySession.id,
        type: TransactionType.SALE,
        referenceId: sale.id,
        concept: `Venta cantina - ${sd.items.length} producto(s)`,
        amountCash: sd.cash,
        amountTransfer: sd.transfer,
        createdByUser: employee1,
        createdByUserId: employee1.id,
      });
    }

    console.log('✅ Ventas POS creadas (12 pasadas + 2 de hoy)');
  }

  await dataSource.destroy();
  console.log('\n🎉 Seed completado exitosamente!');
  console.log('────────────────────────────────────────────────────');
  console.log('  Admin:     admin    / admin123');
  console.log('  Empleado1: empleado / empleado123');
  console.log('  Empleado2: lucia    / lucia123');
  console.log('────────────────────────────────────────────────────');
  console.log('  Reservas: 55 (pasadas completadas, hoy: playing/booked, futuras)');
  console.log('  Caja:     6 sesiones cerradas + 1 abierta (hoy)');
  console.log('  Ventas POS: 14 (12 pasadas + 2 de hoy)');
  console.log('────────────────────────────────────────────────────\n');
}

seed().catch((err) => {
  console.error('❌ Error en el seed:', err.message ?? err);
  process.exit(1);
});
