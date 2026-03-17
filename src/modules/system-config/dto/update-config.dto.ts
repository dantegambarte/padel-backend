import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject, MaxLength } from 'class-validator';

export class UpdateConfigDto {
  @ApiProperty({ example: '3500', description: 'Nuevo valor de la configuración' })
  @IsString()
  @IsNotEmpty({ message: 'El valor es obligatorio.' })
  @MaxLength(500)
  value: string;
}

export class BulkUpdateConfigDto {
  @ApiProperty({
    example: { precio_estandar: '3500', precio_profesor: '2800' },
    description: 'Mapa de clave → valor para actualización masiva',
  })
  @IsObject()
  configs: Record<string, string>;
}
