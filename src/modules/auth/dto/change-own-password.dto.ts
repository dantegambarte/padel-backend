import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ChangeOwnPasswordDto {
  @ApiProperty({ description: 'Contraseña actual del usuario' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria.' })
  currentPassword: string;

  @ApiProperty({ description: 'Nueva contraseña (mínimo 6 caracteres)' })
  @IsString()
  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria.' })
  @MinLength(6, { message: 'La nueva contraseña debe tener al menos 6 caracteres.' })
  newPassword: string;
}
