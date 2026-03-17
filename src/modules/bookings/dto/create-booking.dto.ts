import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsArray,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  ValidateNested,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PriceType } from '../entities/booking.entity';

export class BookingItemInputDto {
  @ApiProperty({ example: 'uuid-del-producto' })
  @IsUUID('4', { message: 'productId debe ser un UUID válido.' })
  productId: string;

  @ApiProperty({ example: 2 })
  @IsNumber({}, { message: 'La cantidad debe ser un número.' })
  @Min(1, { message: 'La cantidad mínima es 1.' })
  quantity: number;
}

export class CreateBookingDto {
  @ApiProperty({ example: 'uuid-de-la-cancha' })
  @IsUUID('4', { message: 'courtId debe ser un UUID válido.' })
  courtId: string;

  @ApiProperty({
    example: '2025-03-15',
    description: 'Fecha del turno en formato YYYY-MM-DD',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato YYYY-MM-DD.',
  })
  date: string;

  @ApiProperty({
    example: '15:00',
    description: 'Hora del turno en formato HH:MM (slots de 1 hora)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, {
    message: 'La hora debe tener el formato HH:MM (ej: 09:00, 15:00).',
  })
  hour: string;

  @ApiProperty({ example: 'Carlos Rodríguez' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del cliente es obligatorio.' })
  @MaxLength(150)
  clientName: string;

  @ApiPropertyOptional({ enum: PriceType, default: PriceType.STANDARD })
  @IsOptional()
  @IsEnum(PriceType, { message: 'El tipo de precio debe ser "standard" o "professor".' })
  priceType?: PriceType;

  @ApiPropertyOptional({
    type: [BookingItemInputDto],
    description: 'Productos consumidos en el turno (buffet)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingItemInputDto)
  items?: BookingItemInputDto[];

  @ApiPropertyOptional({ example: 3000, description: 'Monto pagado en efectivo' })
  @IsOptional()
  @IsNumber({}, { message: 'El monto en efectivo debe ser un número.' })
  @Min(0)
  amountCash?: number;

  @ApiPropertyOptional({ example: 0, description: 'Monto pagado por transferencia' })
  @IsOptional()
  @IsNumber({}, { message: 'El monto por transferencia debe ser un número.' })
  @Min(0)
  amountTransfer?: number;

  @ApiPropertyOptional({ example: 60, description: 'Duración del turno en minutos (30, 60, 90, 120)' })
  @IsOptional()
  @IsInt()
  @Min(30)
  durationMinutes?: number;
}
