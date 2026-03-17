#!/bin/bash
# ══════════════════════════════════════════════════════
#  Setup inicial del VPS DonWeb — Ubuntu 22.04
#  Ejecutar UNA SOLA VEZ como root o con sudo.
#
#  Instala: Node.js 20, PM2, PostgreSQL 15, Nginx, Certbot
# ══════════════════════════════════════════════════════

set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}[VPS Setup] Iniciando configuración del servidor...${NC}"

# ── 1. Actualizar sistema ────────────────────────────────
echo -e "\n${YELLOW}Actualizando paquetes del sistema...${NC}"
apt update && apt upgrade -y

# ── 2. Node.js 20 LTS via NodeSource ───────────────────
echo -e "\n${YELLOW}Instalando Node.js 20 LTS...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version && npm --version

# ── 3. PM2 global ───────────────────────────────────────
echo -e "\n${YELLOW}Instalando PM2...${NC}"
npm install -g pm2
pm2 --version

# ── 4. PostgreSQL 15 ────────────────────────────────────
echo -e "\n${YELLOW}Instalando PostgreSQL 15...${NC}"
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Crear usuario y base de datos
echo -e "${YELLOW}Configurando PostgreSQL...${NC}"
sudo -u postgres psql <<EOF
CREATE USER padel_user WITH PASSWORD 'CAMBIAR_ESTA_PASSWORD';
CREATE DATABASE padelsys_prod OWNER padel_user;
GRANT ALL PRIVILEGES ON DATABASE padelsys_prod TO padel_user;
EOF
echo -e "${GREEN}✓ PostgreSQL configurado. Recordá cambiar la contraseña!${NC}"

# ── 5. Nginx ─────────────────────────────────────────────
echo -e "\n${YELLOW}Instalando Nginx...${NC}"
apt install -y nginx
systemctl enable nginx
systemctl start nginx

# ── 6. Certbot (SSL Let's Encrypt) ──────────────────────
echo -e "\n${YELLOW}Instalando Certbot...${NC}"
apt install -y certbot python3-certbot-nginx

# ── 7. Firewall ──────────────────────────────────────────
echo -e "\n${YELLOW}Configurando UFW (firewall)...${NC}"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 8. Directorio de la app ──────────────────────────────
echo -e "\n${YELLOW}Creando estructura de directorios...${NC}"
mkdir -p /opt/padelsys/backend
mkdir -p /var/www/padelsys          # Frontend Angular compilado
mkdir -p /var/log/padelsys
chown -R $SUDO_USER:$SUDO_USER /opt/padelsys
chown -R $SUDO_USER:$SUDO_USER /var/log/padelsys

# ── 9. Configurar PM2 para arranque automático ───────────
echo -e "\n${YELLOW}Configurando PM2 startup...${NC}"
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $SUDO_USER --hp /home/$SUDO_USER

echo -e "\n${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   VPS configurado correctamente              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  Próximos pasos manuales:"
echo "  1. Clonar el repo: cd /opt/padelsys/backend && git clone <repo-url> ."
echo "  2. Copiar .env:    cp .env.production.example .env && nano .env"
echo "  3. Configurar Nginx: cp nginx/padelsys.conf /etc/nginx/sites-available/padelsys"
echo "     Editar 'tudominio.com' → tu dominio real"
echo "     sudo ln -s /etc/nginx/sites-available/padelsys /etc/nginx/sites-enabled/"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo "  4. Obtener SSL: sudo certbot --nginx -d tudominio.com -d www.tudominio.com"
echo "  5. Primer deploy: bash scripts/deploy.sh"
echo ""
