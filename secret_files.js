// Секретные файлы бота: файловые команды в Telegram (код показать/редактировать/добавить/создать/удалить/
// список/инфо/бэкап/восстановить) не должны их ни читать, ни менять, ни копировать.
// Сравнение без учёта регистра: на Windows Config.json и config.json — один и тот же файл.
const path = require('path');

const SECRET_NAMES = new Set(['session.txt', 'config.json', 'congif.json', 'settings.json', '.env']);
const SECRET_DIRS = new Set(['.git']); // .git/config, хуки — тоже закрыто
// /~\d/ — короткие имена Windows 8.3 (SESSIO~1.TXT, config~1.json): по ним можно открыть секрет в обход списка
const SECRET_RE = [/\.session$/, /^\.env\./, /\.sqlite$/, /\.sqlite-(journal|wal|shm)$/, /~\d/];

function isSecretName(name) {
    // бэкап секретного файла (backups/settings.json_<время>.backup) — тоже секрет
    const n = String(name).toLowerCase().replace(/_\d+\.backup$/, '');
    return SECRET_NAMES.has(n) || SECRET_DIRS.has(n) || SECRET_RE.some(re => re.test(n));
}

// true, если хоть одна часть пути — секретный файл или папка
function isSecretPath(p) {
    return String(p).split(/[\\/]+/).filter(Boolean).some(isSecretName);
}

// Проверка пути из команды бота. baseDir — папка бота. Возвращает полный путь или бросает ошибку.
function resolveBotPath(baseDir, userPath) {
    userPath = String(userPath);
    if (userPath.includes('..')) {
        throw new Error('Недопустимый путь: переходы между директориями запрещены');
    }
    const allowedExt = ['.js', '.json', '.txt', '.md', '.html', '.css', ''];
    if (!allowedExt.includes(path.extname(userPath))) {
        throw new Error('Недопустимое расширение файла');
    }
    const fullPath = path.join(baseDir, userPath);
    if (fullPath !== baseDir && !fullPath.startsWith(baseDir + path.sep)) {
        throw new Error('Недопустимый путь: выход за пределы директории бота');
    }
    if (isSecretPath(path.relative(baseDir, fullPath))) {
        throw new Error('Доступ запрещён: это секретный файл бота');
    }
    return fullPath;
}

// Проверка для «код восстановить <бэкап>»: имя бэкапа без пути, и восстанавливать поверх секретного файла нельзя.
function resolveRestore(baseDir, backupName) {
    backupName = String(backupName);
    if (!backupName || backupName.includes('..') || /[\\/]/.test(backupName)) {
        throw new Error('Укажите имя файла бэкапа без пути');
    }
    const originalName = backupName.replace(/_\d+\.backup$/, '');
    if (isSecretPath(backupName) || isSecretPath(originalName)) {
        throw new Error('Доступ запрещён: это секретный файл бота');
    }
    return {
        backupPath: path.join(baseDir, 'backups', backupName),
        originalName,
        originalPath: resolveBotPath(baseDir, originalName),
    };
}

module.exports = { isSecretName, isSecretPath, resolveBotPath, resolveRestore };
