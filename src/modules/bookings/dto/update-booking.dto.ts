import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookingStatus } from '../entities/booking.entity';
import { BookingItemInputDto } from './create-booking.dto';

export class UpdateBookingDto {
  @ApiPropertyOptional({ example: 'Juan Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  clientName?: string;

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'Cambio de estado del turno. Cancelación solo para admins.',
  })
  @IsOptional()
  @IsEnum(BookingStatus, { message: 'Estado inválido.' })
  status?: BookingStatus;

  @ApiPropertyOptional({
    type: [BookingItemInputDto],
    description:
      'Lista completa de productos. Reemplaza los existentes. Si se envía vacío [] se eliminan todos.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingItemInputDto)
  items?: BookingItemInputDto[];

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountCash?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountTransfer?: number;

  @ApiPropertyOptional({
    example: 'uuid-de-la-cancha',
    description: 'Cancha destino (mover turno)',
  })
  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @ApiPropertyOptional({
    example: '2025-03-15',
    description: 'Fecha destino en formato YYYY-MM-DD (mover turno)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  date?: string;

  @ApiPropertyOptional({
    example: '15:00',
    description: 'Hora destino en formato HH:MM (mover turno)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'La hora debe tener el formato HH:MM.' })
  hour?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Marcar turno fijo como confirmado (isConfirmed = true)',
  })
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  @ApiPropertyOptional({
    example: 4,
    description: 'Cantidad de jugadores en cancha (para dividir el cobro)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  playerCount?: number;
}
