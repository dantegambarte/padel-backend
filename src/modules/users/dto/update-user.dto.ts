import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'María García Actualizada' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ example: 'NuevaContraseña123' })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'La nueva contraseña debe tener al menos 6 caracteres.' })
  password?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: UserRole, example: UserRole.EMPLOYEE })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
