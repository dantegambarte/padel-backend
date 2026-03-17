import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsNumber,
  Min,
  ValidateNested,
  MaxLength,
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
}
