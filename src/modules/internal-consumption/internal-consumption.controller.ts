import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';

import { InternalConsumptionService } from './internal-consumption.service';
import { CreateInternalConsumptionDto } from './dto/create-internal-consumption.dto';
import { QueryInternalConsumptionDto } from './dto/query-internal-consumption.dto';
import { SettleTeacherDebtDto } from './dto/settle-teacher-debt.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('internal-consumption')
export class InternalConsumptionController {
  constructor(private readonly service: InternalConsumptionService) {}

  /** POST /internal-consumption — register a new consumption */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateInternalConsumptionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  /** GET /internal-consumption — list with optional filters */
  @Get()
  findAll(@Query() query: QueryInternalConsumptionDto) {
    return this.service.findAll(query);
  }

  /** GET /internal-consumption/teacher-debt-summary */
  @Get('teacher-debt-summary')
  teacherDebtSummary() {
    return this.service.teacherDebtSummary();
  }

  /** GET /internal-consumption/:id */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** PATCH /internal-consumption/settle — liquidate teacher debt */
  @Patch('settle')
  @HttpCode(HttpStatus.OK)
  settle(@Body() dto: SettleTeacherDebtDto) {
    return this.service.settleTeacherDebt(dto);
  }
}
