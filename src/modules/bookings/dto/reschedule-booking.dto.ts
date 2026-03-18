import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * Payload compartido para Mover y Duplicar un turno.
 * Contiene únicamente los campos que cambian: cancha, fecha y hora destino.
 */
export class RescheduleBookingDto {
  @ApiProperty({ example: 'uuid-de-la-cancha', description: 'ID de la cancha destino' })
  @IsUUID()
  courtId: string;

  @ApiProperty({ example: '2025-07-15', description: 'Fecha destino (YYYY-MM-DD)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener formato YYYY-MM-DD.' })
  date: string;

  @ApiProperty({ example: '10:00', description: 'Hora de inicio destino (HH:MM)' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'La hora debe tener formato HH:MM.' })
  hour: string;
}
