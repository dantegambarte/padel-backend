import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * GET /api/v1/health
 * Public (no JwtAuthGuard) and exempt from rate limiting so deploy scripts,
 * PM2 and Nginx can poll it. 200 when Postgres answers, 503 otherwise.
 */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Estado de la API y de la base de datos' })
  async check(@Res({ passthrough: true }) res: Response) {
    if (await this.healthService.isDatabaseUp()) {
      res.status(HttpStatus.OK);
      return { status: 'ok', db: 'up' };
    }
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'error', db: 'down' };
  }
}
