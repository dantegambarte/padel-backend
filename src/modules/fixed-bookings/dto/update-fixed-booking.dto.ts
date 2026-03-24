import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateFixedBookingDto } from './create-fixed-booking.dto';

export class UpdateFixedBookingDto extends PartialType(CreateFixedBookingDto) {
  @ApiPropertyOptional({ example: false, description: 'Desactivar el turno fijo' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
