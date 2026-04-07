import { IsDateString, IsEnum, IsNumber, IsString, MaxLength, Min } from 'class-validator';
import { ExpenseCategory, PaymentMethod } from '../entities/expense.entity';

export class CreateExpenseDto {
  @IsNumber({}, { message: 'El monto debe ser un número.' })
  @Min(0.01, { message: 'El monto debe ser mayor a cero.' })
  amount: number;

  @IsString()
  @MaxLength(255, { message: 'La descripción no puede superar los 255 caracteres.' })
  description: string;

  @IsEnum(ExpenseCategory, { message: 'Categoría inválida.' })
  category: ExpenseCategory;

  @IsEnum(PaymentMethod, { message: 'Método de pago inválido.' })
  paymentMethod: PaymentMethod;

  /** Fecha comercial en formato YYYY-MM-DD. */
  @IsDateString({}, { message: 'La fecha debe tener formato YYYY-MM-DD.' })
  date: string;
}
