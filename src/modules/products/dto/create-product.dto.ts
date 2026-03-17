import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Agua Mineral 500ml' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    example: 'uuid-de-categoria',
    description: 'UUID de la categoría del producto',
  })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId debe ser un UUID válido.' })
  categoryId?: string;

  @ApiProperty({
    example: 150,
    description: 'Precio de costo (solo visible para admin)',
  })
  @IsNumber({}, { message: 'El precio de costo debe ser un número.' })
  @Min(0)
  costPrice: number;

  @ApiProperty({ example: 300, description: 'Precio de venta al público' })
  @IsNumber({}, { message: 'El precio de venta debe ser un número.' })
  @Min(0)
  salePrice: number;

  @ApiProperty({ example: 48, description: 'Stock inicial' })
  @IsNumber({}, { message: 'El stock debe ser un número entero.' })
  @Min(0)
  stock: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Stock mínimo. Genera alerta en el dashboard cuando se alcanza.',
    default: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Producto destacado: aparece como botón rápido en el modal de Agenda.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
