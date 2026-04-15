import {
  IsUUID,
  IsInt,
  IsPositive,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { InternalConsumptionConsumerType } from '../entities/internal-consumption.entity';

export class CreateInternalConsumptionDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsEnum(InternalConsumptionConsumerType)
  consumerType: InternalConsumptionConsumerType;

  /** Required when consumerType = staff */
  @ValidateIf((o) => o.consumerType === InternalConsumptionConsumerType.STAFF)
  @IsUUID()
  userId?: string;

  /** Required when consumerType = teacher */
  @ValidateIf((o) => o.consumerType === InternalConsumptionConsumerType.TEACHER)
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;

  @IsDateString()
  date: string;
}
