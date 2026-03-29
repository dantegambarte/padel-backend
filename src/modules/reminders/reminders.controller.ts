import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

import { RemindersService, UpcomingReminders } from './reminders.service';

@ApiTags('Reminders')
@Controller('reminders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  /**
   * Devuelve los turnos fijos para hoy y mañana.
   * El frontend lo consume al cargar el layout para poblar la campanita.
   */
  @Get('upcoming')
  @ApiOperation({ summary: 'Turnos fijos de hoy y mañana para recordatorios' })
  getUpcoming(): Promise<UpcomingReminders> {
    return this.remindersService.getUpcoming();
  }
}
