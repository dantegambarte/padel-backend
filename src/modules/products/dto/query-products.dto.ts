import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryProductsDto {
  @ApiPropertyOptional({ description: 'Buscar por nombre' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar por UUID de categoría' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'true → solo productos con stock bajo el mínimo (alertas)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({
    description: 'true → solo productos activos (default). false → incluye inactivos.',
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  onlyActive?: boolean;
}
