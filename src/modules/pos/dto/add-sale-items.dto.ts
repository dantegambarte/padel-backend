import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SaleItemInputDto } from './create-sale.dto';

export class AddSaleItemsDto {
  @ApiProperty({
    type: [SaleItemInputDto],
    description: 'Productos a agregar a la cuenta abierta. Mínimo 1 item.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe agregar al menos un producto.' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items: SaleItemInputDto[];
}
