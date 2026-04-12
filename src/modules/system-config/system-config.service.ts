import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
  ) {}

  /** Retorna todas las claves de configuración como array `[{ key, value }]`. */
  async findAll(): Promise<{ key: string; value: string }[]> {
    const configs = await this.configRepo.find();
    return configs.map((cfg) => ({ key: cfg.key, value: cfg.value }));
  }

  /** Retorna la configuración como mapa `{ key: value }` para uso interno. */
  private async findAllAsMap(): Promise<Record<string, string>> {
    const configs = await this.configRepo.find();
    return configs.reduce(
      (acc, cfg) => {
        acc[cfg.key] = cfg.value;
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  /** Retorna el valor de una clave de configuración. */
  async findByKey(key: string): Promise<string> {
    const config = await this.configRepo.findOne({ where: { key } });
    if (!config) {
      throw new NotFoundException(`Configuración "${key}" no encontrada.`);
    }
    return config.value;
  }

  /** Actualiza el valor de una clave de configuración. */
  async update(key: string, value: string): Promise<SystemConfig> {
    const config = await this.configRepo.findOne({ where: { key } });
    if (!config) {
      throw new NotFoundException(`Configuración "${key}" no encontrada.`);
    }
    config.value = value;
    const saved = await this.configRepo.save(config);
    this.logger.log(`Config actualizada: ${key} = "${value}"`);
    return saved;
  }

  /** Actualiza múltiples claves en una sola operación (crea la clave si no existe). */
  async bulkUpdate(updates: Record<string, string>): Promise<{ key: string; value: string }[]> {
    const entries = Object.entries(updates ?? {});
    if (entries.length === 0) {
      return this.findAll();
    }
    await Promise.all(
      entries.map(async ([key, value]) => {
        const existing = await this.configRepo.findOne({ where: { key } });
        if (existing) {
          existing.value = value;
          return this.configRepo.save(existing);
        } else {
          return this.configRepo.save(this.configRepo.create({ key, value }));
        }
      }),
    );
    this.logger.log(`Config bulk-update: ${entries.map(([k, v]) => `${k}="${v}"`).join(', ')}`);
    return this.findAll();
  }

  /** Retorna los precios estándar y profesor (usado internamente por BookingsService). */
  async getPrices(): Promise<{ standard: number; professor: number }> {
    const all = await this.findAllAsMap();
    return {
      standard: parseFloat(all['precio_estandar'] || '3000'),
      professor: parseFloat(all['precio_profesor'] || '2500'),
    };
  }
}
