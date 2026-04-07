import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsInt,
  Min,
  Max,
  MaxLength,
  Matches,
  ArrayMinSize,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePricingShiftDto {
  @ApiProperty({ example: 'Turno Mañana L-V', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '08:00', description: 'Hora de inicio en formato HH:mm' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:(00|30)$/, { message: 'startTime debe tener formato HH:mm con minutos 00 o 30' })
  startTime: string;

  @ApiProperty({ example: '14:00', description: 'Hora de fin en formato HH:mm' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:(00|30)$/, { message: 'endTime debe tener formato HH:mm con minutos 00 o 30' })
  endTime: string;

  @ApiProperty({
    example: [1, 2, 3, 4, 5],
    description: 'Días de la semana (0=Dom, 1=Lun, ..., 6=Sáb)',
    type: [Number],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe seleccionar al menos un día de la semana.' })
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek: number[];

  @ApiPropertyOptional({
    example: 2000,
    description: 'Precio de alquiler para turnos de 30 min',
    default: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'price30min debe ser un número.' })
  @Min(0)
  price30min?: number;

  @ApiProperty({ example: 3500, description: 'Precio de alquiler para turnos de 60 min' })
  @IsNumber({}, { message: 'price60min debe ser un número.' })
  @Min(0)
  price60min: number;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Precio de alquiler para turnos de 90 min',
    default: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'price90min debe ser un número.' })
  @Min(0)
  price90min?: number;

  @ApiPropertyOptional({
    example: 6500,
    description: 'Precio de alquiler para turnos de 120 min',
    default: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'price120min debe ser un número.' })
  @Min(0)
  price120min?: number;

  @ApiPropertyOptional({
    example: 4000,
    description: 'Precio por hora del profesor (se prorratea según duración)',
    default: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'teacherPricePerHour debe ser un número.' })
  @Min(0)
  teacherPricePerHour?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
