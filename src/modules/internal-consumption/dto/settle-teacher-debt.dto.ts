import { IsUUID, IsOptional, IsString, MaxLength, IsArray } from 'class-validator';

export class SettleTeacherDebtDto {
  @IsUUID()
  teacherId: string;

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
