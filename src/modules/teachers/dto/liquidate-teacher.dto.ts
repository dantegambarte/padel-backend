import { IsArray, IsEnum, IsString, IsUUID, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
}

export class LiquidateTeacherDto {
  @ApiProperty({ description: 'ID del profesor a liquidar', format: 'uuid' })
  @IsUUID()
  teacherId: string;

  @ApiProperty({
    description: 'IDs de turnos completados a marcar como liquidados',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  bookingIds: string[];

  @ApiProperty({
    description: 'IDs de consumos internos pendientes a marcar como pagados',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  consumptionIds: string[];

  @ApiProperty({ enum: PaymentMethod, description: 'Método de pago utilizado' })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
