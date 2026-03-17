import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsIn, Matches } from 'class-validator';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class ReportQueryDto {
  /**
   * Filtro de día exacto. Cuando viene definido, sobreescribe dateFrom/dateTo
   * y restringe la consulta al rango 00:00:00–23:59:59.999 de ese día.
   */
  @ApiPropertyOptional({
    example: '2025-03-15',
    description:
      'Día exacto a consultar (YYYY-MM-DD). Tiene precedencia sobre dateFrom/dateTo. ' +
      'Por defecto: hoy.',
  })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'date debe tener formato YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    example: '2025-03-01',
    description:
      'Fecha de inicio del período (YYYY-MM-DD). Por defecto: primer día del mes actual.',
  })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'dateFrom debe tener formato YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2025-03-31',
    description: 'Fecha de fin del período (YYYY-MM-DD). Por defecto: hoy.',
  })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'dateTo debe tener formato YYYY-MM-DD' })
  dateTo?: string;

  @ApiPropertyOptional({
    example: 'day',
    enum: ['day', 'week', 'month'],
    description: 'Granularidad de agrupación para el reporte de ingresos.',
  })
  @IsOptional()
  @IsIn(['day', 'week', 'month'], {
    message: 'groupBy debe ser "day", "week" o "month"',
  })
  groupBy?: 'day' | 'week' | 'month';
}
