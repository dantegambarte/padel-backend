import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsInt,
  IsIn,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateFixedBookingDto {
  @ApiProperty({ example: 'Rodrigo Pérez' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del cliente es obligatorio.' })
  @MaxLength(150)
  clientName: string;

  @ApiPropertyOptional({ example: '+5491155556666' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;

  /**
   * Día de la semana: 1 = Lunes … 7 = Domingo (ISO 8601).
   */
  @ApiProperty({ example: 1, description: '1=Lunes, 2=Martes, ..., 7=Domingo' })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00', description: 'Hora en formato HH:MM' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, {
    message: 'La hora debe tener el formato HH:MM (ej: 09:00, 15:00).',
  })
  hour: string;

  @ApiPropertyOptional({ example: 60, enum: [30, 60, 90, 120], default: 60 })
  @IsOptional()
  @IsInt()
  @IsIn([30, 60, 90, 120], { message: 'La duración debe ser 30, 60, 90 o 120 minutos.' })
  durationMinutes?: number;

  @ApiProperty({ example: 'uuid-de-la-cancha' })
  @IsUUID('4', { message: 'courtId debe ser un UUID válido.' })
  courtId: string;

  @ApiProperty({
    example: '2026-04-01',
    description: 'Fecha de inicio (YYYY-MM-DD). Se generan turnos desde esta fecha.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de inicio debe tener el formato YYYY-MM-DD.',
  })
  startDate: string;

  @ApiPropertyOptional({ example: 'uuid-del-profesor', description: 'UUID del profesor vinculado (opcional).' })
  @IsOptional()
  @IsUUID('4', { message: 'teacherId debe ser un UUID válido.' })
  teacherId?: string | null;

  @ApiPropertyOptional({ example: 'Trae su propia raqueta' })
  @IsOptional()
  @IsString()
  notes?: string;
}
