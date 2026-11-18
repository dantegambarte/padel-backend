import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * GET /api/v1/health (alias of /ready), /api/v1/health/live, /api/v1/health/ready
 * Public (@Public skips the global JwtAuthGuard) and exempt from rate limiting so deploy scripts,
 * PM2 and Nginx can poll it. 200 when Postgres answers, 503 otherwise.
 */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Kept for compatibility: same contract as /health/ready. */
  @Get()
  @ApiOperation({ summary: 'Estado de la API y de la base de datos (alias de /health/ready)' })
  check(@Res({ passthrough: true }) res: Response) {
    return this.ready(res);
  }

  /** Liveness: the process answers HTTP. Touches no dependency. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness: el proceso responde' })
  live() {
    return { status: 'ok' };
  }

  /** Readiness: 200 when Postgres answers, 503 otherwise. Used by scripts/deploy.sh. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: la API puede atender (verifica la base)' })
  async ready(@Res({ passthrough: true }) res: Response) {
    if (await this.healthService.isDatabaseUp()) {
      res.status(HttpStatus.OK);
      return { status: 'ok', db: 'up' };
    }
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'error', db: 'down' };
  }
}
