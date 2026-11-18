import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Phone sent in the body (not the URL) so it never lands in access logs. */
export class CustomerPhoneDto {
  @ApiProperty({ example: '+5491100000000' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone: string;
}
