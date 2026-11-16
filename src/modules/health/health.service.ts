import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Max time the database probe may take before it counts as down. */
export const DB_PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Runs `SELECT 1`; false on error or when it exceeds DB_PROBE_TIMEOUT_MS. */
  async isDatabaseUp(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${DB_PROBE_TIMEOUT_MS}ms`)),
        DB_PROBE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return true;
    } catch (err) {
      this.logger.warn(`Database health probe failed: ${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
