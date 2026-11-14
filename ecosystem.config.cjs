/**
 * PM2 Ecosystem — PadelSys Backend
 *
 * Instalación en el VPS:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup   ← genera el comando para arranque automático en boot
 *
 * Comandos útiles:
 *   pm2 status                → estado de todos los procesos
 *   pm2 logs padelsys-api     → ver logs en tiempo real
 *   pm2 restart padelsys-api  → reiniciar tras un deploy
 *   pm2 reload padelsys-api   → reinicio sin downtime (zero-downtime reload)
 *   pm2 monit                 → monitor interactivo de CPU/RAM
 */
module.exports = {
  apps: [
    {
      name: 'padelsys-api',
      script: 'dist/main.js',

      // ── Instancias ─────────────────────────────────
      // 'max' → una instancia por núcleo de CPU disponible.
      // Para un VPS básico de 1-2 cores, usar instances: 1 para simplicidad.
      instances: 1,
      exec_mode: 'fork',   // usar 'cluster' si instances > 1

      // ── Auto-restart ───────────────────────────────
      watch: false,                    // nunca watch en producción
      max_memory_restart: '400M',      // reinicia si supera 400MB de RAM
      restart_delay: 3000,             // espera 3s antes de reiniciar tras crash
      max_restarts: 10,               // máximo 10 reinicios en ventana de tiempo
      min_uptime: '10s',              // si cae antes de 10s, cuenta como crash

      // ── Variables de entorno ───────────────────────
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // ── Logs ──────────────────────────────────────
      // Los logs se guardan en /var/log/padelsys/ (ver script de deploy)
      out_file: '/var/log/padelsys/api-out.log',
      error_file: '/var/log/padelsys/api-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Graceful shutdown ──────────────────────────
      // NestJS necesita tiempo para cerrar conexiones de DB
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
