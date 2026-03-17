import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, Matches } from 'class-validator';

export class QueryBookingsDto {
  @ApiProperty({
    example: '2025-03-15',
    description: 'Fecha para filtrar la grilla de turnos (YYYY-MM-DD)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato YYYY-MM-DD.',
  })
  date: string;

  @ApiPropertyOptional({ description: 'Filtrar por cancha específica (UUID)' })
  @IsOptional()
  @IsUUID('4')
  courtId?: string;
}
