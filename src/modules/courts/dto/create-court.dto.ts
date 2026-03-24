import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsArray, IsUUID, Min, MaxLength } from 'class-validator';

export class CreateCourtDto {
  @ApiProperty({ example: 'Cancha 4' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la cancha es obligatorio.' })
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Cancha cubierta con piso de césped' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1500, description: 'Precio por turno de 30 minutos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price30?: number;

  @ApiPropertyOptional({ example: 3000, description: 'Precio por turno de 60 minutos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price60?: number;

  @ApiPropertyOptional({ example: 4500, description: 'Precio por turno de 90 minutos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price90?: number;

  @ApiPropertyOptional({ example: 6000, description: 'Precio por turno de 120 minutos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price120?: number;

  @ApiPropertyOptional({ example: 3000, description: 'Precio especial para turno de 60 minutos con profesor' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  teacherPrice?: number;
}

/** Payload para actualizar precios de múltiples canchas en una sola operación. */
export class BulkPricesDto {
  @ApiProperty({ type: [String], description: 'IDs de las canchas a actualizar' })
  @IsArray()
  @IsUUID('4', { each: true })
  courtIds: string[];

  @ApiProperty({ example: 1500 })
  @IsNumber()
  @Min(0)
  price30: number;

  @ApiProperty({ example: 3000 })
  @IsNumber()
  @Min(0)
  price60: number;

  @ApiProperty({ example: 4500 })
  @IsNumber()
  @Min(0)
  price90: number;

  @ApiProperty({ example: 6000 })
  @IsNumber()
  @Min(0)
  price120: number;

  @ApiProperty({ example: 3000, description: 'Precio con profesor (60 min)' })
  @IsNumber()
  @Min(0)
  teacherPrice: number;
}

export class UpdateCourtDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price30?: number;

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price60?: number;

  @ApiPropertyOptional({ example: 4500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price90?: number;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price120?: number;

  @ApiPropertyOptional({ example: 3000, description: 'Precio con profesor (60 min)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  teacherPrice?: number;
}
