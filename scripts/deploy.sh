#!/bin/bash
# ══════════════════════════════════════════════════════
#  Script de Deploy — PadelSys Backend en DonWeb VPS
#
#  Ejecutar desde el servidor como el usuario de deploy:
#    bash scripts/deploy.sh
#
#  Pre-requisitos en el VPS:
#    - Node.js 20 LTS (via nvm)
#    - PM2 instalado globalmente
#    - PostgreSQL corriendo y configurado
#    - Archivo .env en /opt/padelsys/backend/.env
# ══════════════════════════════════════════════════════

set -e  # Si cualquier comando falla, el script se detiene

# ── Colores para output ─────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # Sin color

APP_DIR="/opt/padelsys/backend"
LOG_DIR="/var/log/padelsys"

echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   PadelSys — Deploy Backend           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"

# ── 1. Verificar directorio ─────────────────────────────
echo -e "\n${YELLOW}[1/7] Verificando entorno...${NC}"
if [ ! -d "$APP_DIR" ]; then
  echo -e "${RED}Error: Directorio $APP_DIR no existe.${NC}"
  echo "Crear con: sudo mkdir -p $APP_DIR && sudo chown \$USER:\$USER $APP_DIR"
  exit 1
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo -e "${RED}Error: Archivo .env no encontrado en $APP_DIR${NC}"
  echo "Crear con: cp .env.production.example .env y completar los valores."
  exit 1
fi

sudo mkdir -p $LOG_DIR
sudo chown $USER:$USER $LOG_DIR
echo -e "${GREEN}✓ Entorno OK${NC}"

# ── 2. Ir al directorio de la app ───────────────────────
cd $APP_DIR
echo -e "\n${YELLOW}[2/7] Actualizando código fuente...${NC}"
git pull origin main
echo -e "${GREEN}✓ Código actualizado${NC}"

# ── 3. Instalar dependencias de producción ──────────────
echo -e "\n${YELLOW}[3/7] Instalando dependencias...${NC}"
npm ci --omit=dev
echo -e "${GREEN}✓ Dependencias instaladas${NC}"

# ── 4. Compilar TypeScript ──────────────────────────────
echo -e "\n${YELLOW}[4/7] Compilando TypeScript...${NC}"
npm run build
echo -e "${GREEN}✓ Build completado en /dist${NC}"

# ── 5. Ejecutar migraciones ──────────────────────────────
echo -e "\n${YELLOW}[5/7] Ejecutando migraciones de base de datos...${NC}"
npm run migration:run
echo -e "${GREEN}✓ Migraciones aplicadas${NC}"

# ── 6. Reiniciar con PM2 ─────────────────────────────────
echo -e "\n${YELLOW}[6/7] Reiniciando servidor con PM2...${NC}"
if pm2 describe padelsys-api > /dev/null 2>&1; then
  # La app ya existe → reload sin downtime
  pm2 reload ecosystem.config.js --env production
  echo -e "${GREEN}✓ Servidor recargado (zero-downtime)${NC}"
else
  # Primera vez → start
  pm2 start ecosystem.config.js --env production
  pm2 save
  echo -e "${GREEN}✓ Servidor iniciado${NC}"
fi

# ── 7. Verificar estado ──────────────────────────────────
echo -e "\n${YELLOW}[7/7] Verificando estado...${NC}"
sleep 2
pm2 status padelsys-api

# Health check básico
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/auth/me || true)
if [ "$HTTP_CODE" = "401" ]; then
  # 401 es correcto: el endpoint existe pero requiere token
  echo -e "${GREEN}✓ API respondiendo correctamente (HTTP 401 esperado en /auth/me)${NC}"
else
  echo -e "${YELLOW}⚠ Health check retornó HTTP $HTTP_CODE. Revisar logs:${NC}"
  echo "   pm2 logs padelsys-api --lines 50"
fi

echo -e "\n${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✓ Deploy completado exitosamente    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "  API:    https://tudominio.com/api/v1"
echo "  Docs:   (deshabilitado en producción)"
echo "  Logs:   pm2 logs padelsys-api"
echo "  Monitor: pm2 monit"
echo ""
