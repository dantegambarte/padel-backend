import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MaxLength, IsIn } from 'class-validator';

export class OpenSessionDto {
  @ApiProperty({
    example: 5000,
    description:
      'Fondo de caja inicial (cambio/vuelto) que el empleado coloca al abrir la jornada. ' +
      'No forma parte del arqueo — es solo referencia operativa.',
  })
  @IsNumber({}, { message: 'El fondo inicial debe ser un número.' })
  @Min(0, { message: 'El fondo inicial no puede ser negativo.' })
  initialBalance: number;

  @ApiPropertyOptional({
    example: 'Apertura normal de jornada.',
    description: 'Observación opcional al abrir la caja.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    enum: ['reopen_today', 'force_next_day'],
    description:
      'Acción a tomar cuando la jornada actual ya fue cerrada. ' +
      '"reopen_today" elimina el cierre del día y reabre la jornada de hoy. ' +
      '"force_next_day" imputa la nueva sesión al día siguiente.',
  })
  @IsOptional()
  @IsIn(['reopen_today', 'force_next_day'], {
    message: 'conflictAction debe ser "reopen_today" o "force_next_day".',
  })
  conflictAction?: 'reopen_today' | 'force_next_day';
}
