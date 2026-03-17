import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsEnum,
  IsOptional,
  Matches,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @ApiProperty({
    example: 'maria_garcia',
    description: 'Nombre de usuario (solo letras, números y guiones bajos)',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de usuario es obligatorio.' })
  @MinLength(3, { message: 'El usuario debe tener al menos 3 caracteres.' })
  @MaxLength(50, { message: 'El usuario no puede superar 50 caracteres.' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'El usuario solo puede contener letras, números y guiones bajos.',
  })
  username: string;

  @ApiProperty({ example: 'María García', description: 'Nombre completo' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio.' })
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: 'Segura123!', description: 'Contraseña (mínimo 6 caracteres)' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres.' })
  password: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.EMPLOYEE })
  @IsOptional()
  @IsEnum(UserRole, { message: 'El rol debe ser "admin" o "employee".' })
  role?: UserRole;
}
