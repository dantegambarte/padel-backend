import { IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';
import {
  InternalConsumptionStatus,
  InternalConsumptionConsumerType,
} from '../entities/internal-consumption.entity';

export class QueryInternalConsumptionDto {
  @IsOptional()
  @IsEnum(InternalConsumptionStatus)
  status?: InternalConsumptionStatus;

  @IsOptional()
  @IsEnum(InternalConsumptionConsumerType)
  consumerType?: InternalConsumptionConsumerType;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
