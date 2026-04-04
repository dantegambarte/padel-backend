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

const MAX_PRODUCTS = 6;
const MAX_BOOKINGS = 3;   // Limitado para evitar saturar con turnos fijos recurrentes.
const MAX_SALES    = 6;

/** Fecha de hoy en zona horaria Argentina (YYYY-MM-DD). */
function todayArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

/**
 * Formatea una fecha YYYY-MM-DD al formato legible "Vie, 11/04/2026".
 * Se usa para el subLabel de las reservas en el buscador.
 */
function formatBookingDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Construir la fecha como local (sin timezone shift) usando UTC noon.
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' });
  const dayStr  = String(day).padStart(2, '0');
  const monStr  = String(month).padStart(2, '0');
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1, 3)}, ${dayStr}/${monStr}/${year}`;
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

    const [products, rawBookings, sales] = await Promise.all([
      // ── Productos de la cantina ─────────────────────────────────────────
      this.productRepo.find({
        where: { name: ILike(`%${term}%`), isActive: true },
        relations: ['category'],
        order: { name: 'ASC' },
        take: MAX_PRODUCTS,
      }),

      // ── Reservas de hoy en adelante (no canceladas) ─────────────────────
      // Traemos más filas de las que necesitamos para poder deduplicar por
      // clientName y mostrar solo la próxima instancia de cada turno fijo.
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
        .take(MAX_BOOKINGS * 10)
        .getMany(),

      // ── Ventas POS (historial completo, con customerName) ───────────────
      this.saleRepo
        .createQueryBuilder('sale')
        .where('sale.customerName ILIKE :term', { term: `%${term}%` })
        .orderBy('sale.createdAt', 'DESC')
        .take(MAX_SALES)
        .getMany(),
    ]);

    // Deduplicar reservas: solo la próxima instancia por clientName.
    const seenClients = new Set<string>();
    const bookings: Booking[] = [];
    for (const b of rawBookings) {
      const key = b.clientName.trim().toLowerCase();
      if (!seenClients.has(key)) {
        seenClients.add(key);
        bookings.push(b);
      }
      if (bookings.length >= MAX_BOOKINGS) break;
    }

    return {
      products: products.map((p) => ({
        id: p.id,
        label: p.name,
        subLabel: p.category?.name ?? '',
      })),

      bookings: bookings.map((b) => ({
        id: b.id,
        label: b.clientName,
        subLabel: `${formatBookingDate(b.date)} | ${b.court?.name ?? ''} — ${b.hour}hs`,
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
