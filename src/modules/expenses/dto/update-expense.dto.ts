import { PartialType } from '@nestjs/mapped-types';
import { CreateExpenseDto } from './create-expense.dto';

/** Todos los campos son opcionales en una actualización parcial (PATCH). */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
