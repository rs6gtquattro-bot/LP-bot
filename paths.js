const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Проверка, является ли каталог временным или виртуальным (распаковка .exe / snapshot / asar)
 */
function isTempOrVirtual(dir) {
    if (!dir) return true;
    const normalized = path.normalize(path.resolve(dir)).toLowerCase();
    const tempDir = os.tmpdir().toLowerCase();

    return (
        normalized.startsWith(tempDir) ||
        normalized.includes(path.sep + 'temp' + path.sep) ||
        normalized.includes(path.sep + 'tmp' + path.sep) ||
        normalized.endsWith(path.sep + 'temp') ||
        normalized.endsWith(path.sep + 'tmp') ||
        normalized.includes('appdata' + path.sep + 'local' + path.sep + 'temp') ||
        normalized.includes('snapshot') ||
        normalized.includes('.asar')
    );
}

function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error(`❌ Не удалось создать директорию ${dir}:`, e.message);
        }
    }
}

/**
 * Получение безопасной постоянной директории данных приложения (DATA_DIR)
 */
function resolveDataDir() {
    // 1. Приоритет: явная переменная окружения
    if (process.env.LP_DATA_DIR && process.env.LP_DATA_DIR.trim()) {
        const customDir = path.resolve(process.env.LP_DATA_DIR.trim());
        ensureDirSync(customDir);
        return customDir;
    }

    // 2. Portable executable (electron-builder portable)
    if (process.env.PORTABLE_EXECUTABLE_DIR && process.env.PORTABLE_EXECUTABLE_DIR.trim()) {
        const portableDir = path.resolve(process.env.PORTABLE_EXECUTABLE_DIR.trim());
        ensureDirSync(portableDir);
        return portableDir;
    }

    // 3. Node.js pkg (process.pkg)
    if (process.pkg) {
        const exeDir = path.dirname(process.execPath);
        if (!isTempOrVirtual(exeDir)) {
            return exeDir;
        }
    }

    // 4. Electron packaged (скомпилированный автономный экзешник)
    if (process.versions && process.versions.electron) {
        const exeDir = path.dirname(process.execPath);
        const isDevElectron = /[\\/]node_modules[\\/]electron[\\/]/.test(process.execPath.toLowerCase()) || Boolean(process.defaultApp);
        if (!isDevElectron && !isTempOrVirtual(exeDir)) {
            return exeDir;
        }
    }

    // 5. Обычный запуск из репозитория: проверяем __dirname
    const localDir = path.resolve(__dirname);
    if (!isTempOrVirtual(localDir)) {
        return localDir;
    }

    // 6. Если __dirname оказался во временной папке (распаковка .exe в %TEMP%):
    // Эвакуируем в постоянную директорию пользователя (%APPDATA%\LP-bot на Windows или ~/.lpbot на POSIX)
    const fallbackDir = process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'LP-bot')
        : path.join(os.homedir(), '.lpbot');

    ensureDirSync(fallbackDir);
    console.warn(`⚠️ ВНИМАНИЕ: Обнаружен запуск из временного каталога (${localDir})!`);
    console.warn(`📁 Каталог данных автоматически зафиксирован в постоянном хранилище: ${fallbackDir}`);
    return fallbackDir;
}

const DATA_DIR = resolveDataDir();
ensureDirSync(DATA_DIR);

const DB_PATH = path.join(DATA_DIR, 'bot_database.sqlite');
const SESSION_PATH = path.join(DATA_DIR, 'session.txt');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

ensureDirSync(BACKUPS_DIR);

// Если в DATA_DIR нет config.json / settings.json, но рядом с кодом есть example-файлы, копируем их
function initDefaultConfigsIfMissing() {
    try {
        const projectRoot = path.resolve(__dirname);
        if (DATA_DIR !== projectRoot) {
            const configExample = path.join(projectRoot, 'config.example.json');
            if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(configExample)) {
                fs.copyFileSync(configExample, CONFIG_PATH);
                console.log(`📋 Скопирован шаблон конфигурации: ${CONFIG_PATH}`);
            }

            const settingsExample = path.join(projectRoot, 'settings.example.json');
            if (!fs.existsSync(SETTINGS_PATH) && fs.existsSync(settingsExample)) {
                fs.copyFileSync(settingsExample, SETTINGS_PATH);
                console.log(`📋 Скопирован шаблон настроек: ${SETTINGS_PATH}`);
            }
        }
    } catch (e) {
        console.warn('⚠️ Не удалось инициализировать дефолтные конфиги:', e.message);
    }
}

initDefaultConfigsIfMissing();

module.exports = {
    getDataDir: () => DATA_DIR,
    DATA_DIR,
    DB_PATH,
    SESSION_PATH,
    CONFIG_PATH,
    SETTINGS_PATH,
    BACKUPS_DIR,
    isTempOrVirtual
};
