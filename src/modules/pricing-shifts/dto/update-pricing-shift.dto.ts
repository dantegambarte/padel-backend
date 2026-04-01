import { PartialType } from '@nestjs/swagger';
import { CreatePricingShiftDto } from './create-pricing-shift.dto';

export class UpdatePricingShiftDto extends PartialType(CreatePricingShiftDto) {}
