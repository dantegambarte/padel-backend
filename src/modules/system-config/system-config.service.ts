import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
  ) {}

  /** Retorna todas las claves como array [{ key, value }] */
  async findAll(): Promise<{ key: string; value: string }[]> {
    const configs = await this.configRepo.find();
    return configs.map((cfg) => ({ key: cfg.key, value: cfg.value }));
  }

  /** Helper interno: retorna objeto plano { key: value } */
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

  async findByKey(key: string): Promise<string> {
    const config = await this.configRepo.findOne({ where: { key } });
    if (!config) {
      throw new NotFoundException(`Configuración "${key}" no encontrada.`);
    }
    return config.value;
  }

  async update(key: string, value: string): Promise<SystemConfig> {
    const config = await this.configRepo.findOne({ where: { key } });
    if (!config) {
      throw new NotFoundException(`Configuración "${key}" no encontrada.`);
    }
    config.value = value;
    return this.configRepo.save(config);
  }

  /** Actualización masiva (para el formulario de Configuración del prototipo) */
  async bulkUpdate(updates: Record<string, string>): Promise<{ key: string; value: string }[]> {
    // Si el frontend envía un objeto vacío (sin cambios detectados), devolvemos
    // el estado actual sin tocar la BD. Evita el error 400 al guardar sin modificar.
    const entries = Object.entries(updates ?? {});
    if (entries.length === 0) {
      return this.findAll();
    }
    await Promise.all(entries.map(([key, value]) => this.update(key, value)));
    return this.findAll();
  }

  /** Helper para obtener precios (usado internamente por BookingsService) */
  async getPrices(): Promise<{ standard: number; professor: number }> {
    const all = await this.findAllAsMap();
    return {
      standard: parseFloat(all['precio_estandar'] || '3000'),
      professor: parseFloat(all['precio_profesor'] || '2500'),
    };
  }
}
