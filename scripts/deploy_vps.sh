#!/usr/bin/env bash
# ==============================================================================
# LP-bot VPS Deployment Script (Turnkey Installer)
# Supported OS: Ubuntu 20.04/22.04/24.04, Debian 11/12
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err()  { echo -e "${RED}[ERR]${NC} $1"; }

INSTALL_DIR="${INSTALL_DIR:-/opt/lpbot}"
REPO_URL="${REPO_URL:-https://github.com/rs6gtquattro-bot/LP-bot.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "=========================================================="
echo "          LP-bot Turnkey VPS Deployment Script           "
echo "=========================================================="

# 1. Root check
if [ "$(id -u)" -ne 0 ]; then
    log_err "Этот скрипт должен выполняться с правами root (sudo)."
    exit 1
fi

# 2. System updates and base dependencies
log_info "Обновление системных пакетов и установка зависимостей..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    git \
    build-essential \
    python3 \
    sqlite3

# 3. Node.js setup (NodeSource)
CURRENT_NODE_VER=""
if command -v node >/dev/null 2>&1; then
    CURRENT_NODE_VER=$(node -v | cut -d'.' -f1 | tr -d 'v')
fi

if [ -z "$CURRENT_NODE_VER" ] || [ "$CURRENT_NODE_VER" -lt 18 ]; then
    log_info "Установка Node.js ${NODE_MAJOR}.x LTS..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
else
    log_ok "Node.js уже установлен: $(node -v)"
fi

# 4. PM2 installation
if ! command -v pm2 >/dev/null 2>&1; then
    log_info "Установка глобального менеджера процессов PM2..."
    npm install -g pm2
else
    log_ok "PM2 уже установлен: $(pm2 -v)"
fi

# 5. Clone or deploy into target directory
mkdir -p "$INSTALL_DIR"
SCRIPT_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "${SCRIPT_SRC_DIR}/main.js" ] && [ "${SCRIPT_SRC_DIR}" != "${INSTALL_DIR}" ]; then
    log_info "Синхронизация файлов проекта из ${SCRIPT_SRC_DIR} в ${INSTALL_DIR}..."
    if command -v rsync >/dev/null 2>&1; then
        rsync -av --exclude 'node_modules' --exclude '.git' --exclude 'logs' --exclude '*.sqlite*' --exclude 'session.txt' --exclude 'config.json' "${SCRIPT_SRC_DIR}/" "${INSTALL_DIR}/"
    else
        cp -rn "${SCRIPT_SRC_DIR}/"* "${INSTALL_DIR}/" 2>/dev/null || true
    fi
elif [ ! -f "${INSTALL_DIR}/main.js" ]; then
    log_info "Клонирование репозитория в ${INSTALL_DIR}..."
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# 6. Install Node.js dependencies
log_info "Установка npm зависимостей (production)..."
npm install --omit=dev

# 7. Configure secrets and configuration files
log_info "Проверка конфигурационных файлов..."
mkdir -p logs

if [ ! -f config.json ]; then
    if [ -f config.example.json ]; then
        cp config.example.json config.json
        log_warn "Создан config.json из config.example.json. Не забудьте внести API ID, API Hash и VK токен!"
    else
        log_err "config.example.json не найден!"
    fi
fi

if [ ! -f settings.json ] && [ -f settings.example.json ]; then
    cp settings.example.json settings.json
fi

# Fix permissions on sensitive files (chmod 600)
chmod 600 config.json 2>/dev/null || true
chmod 600 settings.json 2>/dev/null || true
chmod 600 session.txt 2>/dev/null || true
chmod 600 bot_database.sqlite* 2>/dev/null || true

# 8. Start/Restart service via PM2
log_info "Запуск LP-bot через PM2..."
if pm2 describe lpbot >/dev/null 2>&1; then
    pm2 restart lpbot
else
    if [ -f ecosystem.config.js ]; then
        pm2 start ecosystem.config.js
    else
        pm2 start main.js --name lpbot --max-memory-restart 300M --time
    fi
fi

pm2 save
pm2 startup systemd -u root --hp /root || true

echo "=========================================================="
log_ok "LP-bot успешно развёрнут и запущен!"
echo "=========================================================="
echo -e "Статус процесса:"
pm2 status lpbot
echo ""
echo -e "Рабочая директория: ${INSTALL_DIR}"
echo -e "Веб-панель:        http://<IP_СЕРВЕРА>:3005/"
echo -e "Логи PM2:          pm2 logs lpbot"
echo -e "Перезапуск:        pm2 restart lpbot"
echo -e "Остановка:         pm2 stop lpbot"
echo ""
echo -e "${YELLOW}[ВНИМАНИЕ]${NC} Если Telegram заблокирован провайдером/РКН, укажите прокси в ${INSTALL_DIR}/config.json:"
echo -e '  "telegramProxy": "socks5://login:pass@ip:port"'
echo "=========================================================="
