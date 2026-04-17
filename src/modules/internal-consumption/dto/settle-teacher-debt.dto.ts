import { IsUUID, IsOptional, IsString, MaxLength, IsArray, IsEnum } from 'class-validator';

export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
}

export class SettleTeacherDebtDto {
  @IsUUID()
  teacherId: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  /** If provided, settle only these specific consumption IDs. If omitted, settle all pending. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  consumptionIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
