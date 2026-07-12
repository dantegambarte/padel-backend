import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class PaySaleDto {
  @ApiPropertyOptional({ example: 1500, description: 'Monto abonado en efectivo', default: 0 })
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
