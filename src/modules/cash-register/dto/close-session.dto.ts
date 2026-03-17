import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CloseSessionDto {
  @ApiProperty({
    example: 32500,
    description:
      'Monto de efectivo físico contado por el empleado al final del día.',
  })
  @IsNumber({}, { message: 'El monto contado debe ser un número.' })
  @Min(0, { message: 'El monto no puede ser negativo.' })
  cashCounted: number;

  @ApiPropertyOptional({
    example: 'Todo cuadra. Sin novedades.',
    description: 'Observaciones opcionales del cierre (campo de notas del arqueo).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
