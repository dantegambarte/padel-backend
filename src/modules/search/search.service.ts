import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';

import { Product } from '../products/entities/product.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { Sale } from '../pos/entities/sale.entity';

export interface SearchResultItem {
  id: string;
  label: string;
  subLabel?: string;
  /** Fecha YYYY-MM-DD: en Bookings = turno.date; en Sales = fecha de la venta. */
  date?: string;
}

export interface SearchResponse {
  products: SearchResultItem[];
  bookings: SearchResultItem[];
  sales: SearchResultItem[];
}

const MAX_RESULTS_PER_CATEGORY = 6;

/** Fecha de hoy en zona horaria Argentina (YYYY-MM-DD). */
function todayArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    @InjectRepository(Sale)
    private readonly saleRepo: Repository<Sale>,
  ) {}

  async search(q: string): Promise<SearchResponse> {
    const term = q.trim();
    if (!term) return { products: [], bookings: [], sales: [] };

    const today = todayArgentina();

    const [products, bookings, sales] = await Promise.all([
      // ── Productos de la cantina ─────────────────────────────────────────
      this.productRepo.find({
        where: { name: ILike(`%${term}%`), isActive: true },
        relations: ['category'],
        order: { name: 'ASC' },
        take: MAX_RESULTS_PER_CATEGORY,
      }),

      // ── Reservas de hoy en adelante (no canceladas) ─────────────────────
      this.bookingRepo
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.court', 'court')
        .where('booking.clientName ILIKE :term', { term: `%${term}%` })
        .andWhere('booking.status != :cancelled', {
          cancelled: BookingStatus.CANCELLED,
        })
        .andWhere('booking.date >= :today', { today })
        .orderBy('booking.date', 'ASC')
        .addOrderBy('booking.hour', 'ASC')
        .take(MAX_RESULTS_PER_CATEGORY)
        .getMany(),

      // ── Ventas POS del día de hoy (con customerName) ────────────────────
      this.saleRepo
        .createQueryBuilder('sale')
        .where('sale.customerName ILIKE :term', { term: `%${term}%` })
        .andWhere(
          `DATE(sale.createdAt AT TIME ZONE 'America/Argentina/Buenos_Aires') >= :today`,
          { today },
        )
        .orderBy('sale.createdAt', 'DESC')
        .take(MAX_RESULTS_PER_CATEGORY)
        .getMany(),
    ]);

    return {
      products: products.map((p) => ({
        id: p.id,
        label: p.name,
        subLabel: p.category?.name ?? '',
      })),

      bookings: bookings.map((b) => ({
        id: b.id,
        label: b.clientName,
        subLabel: `${b.court?.name ?? ''} — ${b.hour}hs`,
        date: b.date,
      })),

      sales: sales.map((s) => {
        const saleDate = new Intl.DateTimeFormat('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date(s.createdAt));
        const total = Number(s.total).toLocaleString('es-AR');
        return {
          id: s.id,
          label: s.customerName ?? 'Cliente sin nombre',
          subLabel: `${saleDate} — Total: $${total}`,
          date: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Argentina/Buenos_Aires',
          }).format(new Date(s.createdAt)),
        };
      }),
    };
  }
}
