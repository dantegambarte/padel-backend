import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SaleItemInputDto {
  @ApiProperty({ example: 'uuid-del-producto' })
  @IsUUID('4', { message: 'productId debe ser un UUID válido.' })
  productId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsNumber({}, { message: 'La cantidad debe ser un número.' })
  @Min(1, { message: 'La cantidad mínima es 1.' })
  quantity: number;
}

export class CreateSaleDto {
  @ApiPropertyOptional({ example: 'Juan Pérez', description: 'Nombre del cliente (opcional)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @ApiProperty({
    type: [SaleItemInputDto],
    description: 'Productos del carrito. Mínimo 1 item.',
  })
  @IsArray()
  @IsNotEmpty()
  @ArrayMinSize(1, { message: 'La venta debe tener al menos un producto.' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items: SaleItemInputDto[];

  @ApiPropertyOptional({
    example: 1500,
    description: 'Monto abonado en efectivo',
    default: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'amountCash debe ser un número.' })
  @Min(0, { message: 'El monto en efectivo no puede ser negativo.' })
  amountCash?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Monto abonado por transferencia bancaria',
    default: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'amountTransfer debe ser un número.' })
  @Min(0, { message: 'El monto por transferencia no puede ser negativo.' })
  amountTransfer?: number;
}
