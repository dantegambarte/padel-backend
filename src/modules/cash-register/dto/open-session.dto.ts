import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class OpenSessionDto {
  @ApiProperty({
    example: 5000,
    description:
      'Fondo de caja inicial (cambio/vuelto) que el empleado coloca al abrir la jornada. ' +
      'No forma parte del arqueo — es solo referencia operativa.',
  })
  @IsNumber({}, { message: 'El fondo inicial debe ser un número.' })
  @Min(0, { message: 'El fondo inicial no puede ser negativo.' })
  initialBalance: number;

  @ApiPropertyOptional({
    example: 'Apertura normal de jornada.',
    description: 'Observación opcional al abrir la caja.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
