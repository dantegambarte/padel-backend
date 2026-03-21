import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { SearchService } from './search.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Búsqueda Global')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * GET /api/v1/search?q=término
   *
   * Búsqueda rápida simultánea en:
   *   - Nombres de productos activos de la Cantina
   *   - Nombres de clientes en Reservas no canceladas
   *
   * Rate limiting reforzado: máx. 30 req/min para este endpoint
   * (el frontend ya aplica debounce de 300ms, esto es solo backstop).
   *
   * Acceso: Admin y Empleado.
   */
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Búsqueda global (productos + reservas + ventas POS)',
    description:
      'Retorna hasta 6 coincidencias por categoría. Reservas y ventas filtradas por fecha >= hoy. El frontend aplica debounce de 300ms antes de llamar.',
  })
  @ApiQuery({ name: 'q', type: 'string', description: 'Término de búsqueda (mínimo 1 carácter)' })
  @ApiResponse({ status: 200, description: 'Resultados agrupados por categoría.' })
  search(@Query('q') q = '') {
    return this.searchService.search(q);
  }
}
