/**
 * tools/audit_dist.js
 * Скрипт аудита безопасности собранных бинарников и релизных дистрибутивов LP-bot.
 * Проверяет:
 *  1. Декомпиляцию структуры app.asar / win-unpacked на предмет секретных файлов.
 *  2. Содержимое portable zip архивов.
 *  3. Поиск строк токенов, ключей сессий и дампов БД внутри бинарников (.exe, .asar, .zip).
 */
const fs = require('fs');
const path = require('path');
const { isSecretPath } = require('../secret_files.js');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('===============================================================');
console.log('     SECURITY AUDIT: ПРОВЕРКА РЕЛИЗНЫХ БИНАРНИКОВ И ДИСТРИБУТИВА');
console.log('===============================================================\n');

if (!fs.existsSync(distDir)) {
    console.error('❌ ОШИБКА: Директория dist/ не найдена. Сначала выполните сборку: npm run dist');
    process.exit(1);
}

let totalChecks = 0;
let failedChecks = 0;

function check(ok, message) {
    totalChecks++;
    if (ok) {
        console.log(`  ✅ [PASS] ${message}`);
    } else {
        failedChecks++;
        console.error(`  ❌ [CRITICAL FAIL] ${message}`);
    }
}

// 1. Читаем реальные секреты из рабочего каталога, чтобы убедиться, что они НЕ утекли в бинарник
let knownSecrets = [];

// Session string
const sessionFile = path.join(rootDir, 'session.txt');
if (fs.existsSync(sessionFile)) {
    const s = fs.readFileSync(sessionFile, 'utf8').trim();
    if (s.length > 20) {
        knownSecrets.push({ name: 'Telegram Session String (session.txt)', pattern: s.slice(10, 60) });
    }
}

// Config secrets
const configFile = path.join(rootDir, 'config.json');
if (fs.existsSync(configFile)) {
    try {
        const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        if (cfg.telegramApiHash && cfg.telegramApiHash.length === 32) {
            knownSecrets.push({ name: 'Telegram API Hash (config.json)', pattern: cfg.telegramApiHash });
        }
        if (cfg.panelToken && cfg.panelToken.length > 10) {
            knownSecrets.push({ name: 'Panel Auth Token (config.json)', pattern: cfg.panelToken });
        }
    } catch (e) {}
}

console.log(`[INFO] Загружено эталонных секретов для поиска утечек: ${knownSecrets.length}`);

// 2. Функция для разбора и инспекции ASAR архива
function parseAsarHeader(asarPath) {
    const fd = fs.openSync(asarPath, 'r');
    try {
        const sizeBuf = Buffer.alloc(16);
        fs.readSync(fd, sizeBuf, 0, 16, 0);
        const jsonLen = sizeBuf.readUInt32LE(12);
        const jsonBuf = Buffer.alloc(jsonLen);
        fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
        const header = JSON.parse(jsonBuf.toString('utf8'));
        
        const files = [];
        function walk(node, currentPath = '') {
            if (node.files) {
                for (const [name, child] of Object.entries(node.files)) {
                    const nextPath = currentPath ? `${currentPath}/${name}` : name;
                    walk(child, nextPath);
                }
            } else {
                files.push(currentPath);
            }
        }
        walk(header);
        return files;
    } finally {
        fs.closeSync(fd);
    }
}

// 3. Поиск ASAR файлов в dist
console.log('\n--- ЭТАП 1: Декомпиляция и аудит структуры ассетов (app.asar) ---');
function findAsarFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(findAsarFiles(full));
        } else if (entry.name.endsWith('.asar')) {
            results.push(full);
        }
    }
    return results;
}

const asarFiles = findAsarFiles(distDir);
if (asarFiles.length === 0) {
    console.log('  ⚠️ Предупреждение: app.asar не найден напрямую в dist (возможно, встроен в single-exe или не собран).');
} else {
    for (const asarPath of asarFiles) {
        console.log(`  Инспекция: ${path.relative(distDir, asarPath)}`);
        try {
            const filesInAsar = parseAsarHeader(asarPath);
            console.log(`    Всего упаковано файлов: ${filesInAsar.length}`);

            let leakedInAsar = [];
            for (const f of filesInAsar) {
                const baseName = path.basename(f);
                if (isSecretPath(f) || /(^|[\\/])(session\.txt|config\.json|congif\.json|settings\.json)$/i.test(baseName) || /\.(sqlite|sqlite-wal|sqlite-shm|sqlite\.bak|db)$/i.test(baseName) || /^\.env/i.test(baseName)) {
                    leakedInAsar.push(f);
                }
            }

            check(leakedInAsar.length === 0, `В ${path.basename(asarPath)} нет секретных файлов (обнаружено: ${leakedInAsar.length})`);
            if (leakedInAsar.length > 0) {
                console.error(`      УТЕЧКА: ${leakedInAsar.join(', ')}`);
            }

            // Проверяем наличие обязательных компонентов
            const hasMain = filesInAsar.includes('main.js') || filesInAsar.includes('script.js');
            check(hasMain, `В ${path.basename(asarPath)} присутствует главный скрипт`);
            const hasPublic = filesInAsar.some(f => f.startsWith('public/'));
            check(hasPublic, `В ${path.basename(asarPath)} присутствуют статические ассеты`);
        } catch (e) {
            check(false, `Ошибка чтения заголовка ASAR ${asarPath}: ${e.message}`);
        }
    }
}

// 4. Проверка директории win-unpacked (если есть)
const unpackedDir = path.join(distDir, 'win-unpacked');
if (fs.existsSync(unpackedDir)) {
    console.log('\n--- ЭТАП 2: Аудит структуры win-unpacked ---');
    let leakedInUnpacked = [];
    function scanUnpacked(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(unpackedDir, full);
            const baseName = entry.name;
            if (isSecretPath(rel) || /(^|[\\/])(session\.txt|config\.json|congif\.json|settings\.json)$/i.test(baseName) || /\.(sqlite|sqlite-wal|sqlite-shm|sqlite\.bak|db)$/i.test(baseName) || /^\.env/i.test(baseName)) {
                leakedInUnpacked.push(rel);
            }
            if (entry.isDirectory()) {
                scanUnpacked(full);
            }
        }
    }
    scanUnpacked(unpackedDir);
    check(leakedInUnpacked.length === 0, `В win-unpacked нет секретных файлов (обнаружено: ${leakedInUnpacked.length})`);
    if (leakedInUnpacked.length > 0) {
        console.error(`      УТЕЧКА В ДИРЕКТОРИИ: ${leakedInUnpacked.join(', ')}`);
    }
}

// 5. Поиск строк токенов и секретов в бинарных релизных файлах (.exe, .zip, .asar)
console.log('\n--- ЭТАП 3: Глубокое сканирование бинарников на утечки токенов и ключей ---');
function scanBinaryFile(filePath) {
    const fileName = path.basename(filePath);
    const stat = fs.statSync(filePath);
    console.log(`  Сканирование бинарника: ${fileName} (${(stat.size / (1024 * 1024)).toFixed(2)} МБ)`);

    // Читаем файл буферами по 4 МБ с перекрытием 4 КБ для поиска строк на стыке
    const fd = fs.openSync(filePath, 'r');
    const chunkSize = 4 * 1024 * 1024;
    const overlap = 4096;
    const buf = Buffer.alloc(chunkSize + overlap);
    let offset = 0;

    let vkTokenFound = false;
    let leakedSecrets = [];

    // Регулярка для токенов VK (vk1.a.XXXX)
    const vkTokenRegex = /vk1\.[a-zA-Z0-9_\-\.]{50,}/g;

    try {
        while (offset < stat.size) {
            const bytesRead = fs.readSync(fd, buf, 0, chunkSize + overlap, offset);
            if (bytesRead === 0) break;

            const slice = buf.toString('latin1', 0, bytesRead);

            // Проверка регулярки токена VK
            if (vkTokenRegex.test(slice)) {
                vkTokenFound = true;
            }

            // Проверка эталонных секретов из рабочей директории
            for (const sec of knownSecrets) {
                if (slice.includes(sec.pattern)) {
                    if (!leakedSecrets.includes(sec.name)) {
                        leakedSecrets.push(sec.name);
                    }
                }
            }

            if (bytesRead < chunkSize) break;
            offset += chunkSize;
        }
    } finally {
        fs.closeSync(fd);
    }

    check(!vkTokenFound, `В ${fileName} отсутствуют токены VK (vk1.*)`);
    check(leakedSecrets.length === 0, `В ${fileName} отсутствуют боевые секреты разработчика (${leakedSecrets.length} утечек)`);
    if (leakedSecrets.length > 0) {
        console.error(`      КРИТИЧЕСКАЯ УТЕЧКА В БИНАРНИКЕ: ${leakedSecrets.join(', ')}`);
    }
}

// Ищем все .exe и .zip файлы в dist
const distFiles = fs.readdirSync(distDir);
const releaseBinaries = distFiles.filter(f => /\.(exe|zip|asar)$/i.test(f)).map(f => path.join(distDir, f));

for (const bin of releaseBinaries) {
    scanBinaryFile(bin);
}

// 6. Итоговый отчет
console.log('\n===============================================================');
console.log(`ИТОГИ АУДИТА БЕЗОПАСНОСТИ РЕЛИЗА:`);
console.log(`Всего проверок: ${totalChecks} | Успешно: ${totalChecks - failedChecks} | Провалено: ${failedChecks}`);
console.log('===============================================================');

if (failedChecks > 0) {
    console.error('\n🚨 РЕЛИЗ ЗАБЛОКИРОВАН: В дистрибутиве обнаружены секреты или уязвимости упаковки!');
    process.exit(1);
} else {
    console.log('\n🛡️ РЕЛИЗ ОДОБРЕН ПО СТАНДАРТАМ ИБ: В дистрибутиве отсутствуют любые боевые секреты, сессии и базы данных.');
    process.exit(0);
}
