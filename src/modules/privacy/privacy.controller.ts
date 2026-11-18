import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

import { CustomerPhoneDto } from './dto/customer-phone.dto';
import { CustomerExport, EraseResult, PrivacyService } from './privacy.service';

@ApiTags('Privacy')
@Controller('privacy')
@Roles(UserRole.ADMIN)
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Post('customers/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export every record holding a customer phone' })
  export(@Body() dto: CustomerPhoneDto): Promise<CustomerExport> {
    return this.privacyService.exportByPhone(dto.phone);
  }

  @Post('customers/erase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Erase a customer phone and anonymize their name' })
  erase(@Body() dto: CustomerPhoneDto): Promise<EraseResult> {
    return this.privacyService.eraseByPhone(dto.phone);
  }
}
