import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SaleStatus } from '../entities/sale.entity';

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
  @ApiPropertyOptional({
    enum: SaleStatus,
    default: SaleStatus.PAID,
    description: "'open' = cuenta abierta (cobro pendiente), 'paid' = venta cobrada al momento.",
  })
  @IsOptional()
  @IsEnum(SaleStatus, { message: 'status debe ser "open" o "paid".' })
  status?: SaleStatus;

  @ApiPropertyOptional({
    example: 'Juan Pérez',
    description:
      'Nombre del cliente. Obligatorio si status es "open" (para identificar la cuenta).',
  })
  @ValidateIf((dto: CreateSaleDto) => dto.status === SaleStatus.OPEN)
  @IsNotEmpty({ message: 'customerName es obligatorio para abrir una cuenta (status "open").' })
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
