/**
 * PM2 ecosystem — La Caldera backend (production)
 *
 * Runs the compiled app directly (no npm wrapper), bound to loopback only.
 * Nginx (managed by CloudPanel) is the only public entry point.
 *
 *   pnpm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Useful:
 *   pm2 logs padel-backend
 *   pm2 restart padel-backend   # after a new build
 *
 * Secrets stay in .env (loaded by ConfigModule from cwd), never here.
 */
module.exports = {
  apps: [
    {
      name: 'padel-backend',
      script: 'dist/main.js',
      cwd: __dirname,

      instances: 1,
      exec_mode: 'fork',

      watch: false,
      max_memory_restart: '400M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',

      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3002,
      },

      // Logs go to PM2's default location (~/.pm2/logs).
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Give NestJS time to close DB connections.
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
