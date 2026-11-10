// Тест безопасности релизной сборки и фильтров сборщика
const path = require('path');
const fs = require('fs');
const { isSecretPath } = require('../secret_files.js');

let fail = 0;
const t = (ok, msg) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', msg); };

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

console.log('--- ТЕСТЫ БЕЗОПАСНОСТИ СБОРЩИКА И РЕЛИЗНЫХ ФИЛЬТРОВ ---');

// 1. Проверка фильтров electron-builder в package.json
t(Boolean(pkg.build), 'package.json содержит секцию build');
t(Array.isArray(pkg.build.files), 'build.files определен как массив');

const files = pkg.build.files || [];
const hasExclusion = (pattern) => files.some(f => f.startsWith('!') && f.includes(pattern));

t(hasExclusion('session.txt'), 'build.files исключает session.txt');
t(hasExclusion('config.json'), 'build.files исключает config.json');
t(hasExclusion('settings.json'), 'build.files исключает settings.json');
t(hasExclusion('.sqlite'), 'build.files исключает базы данных .sqlite');
t(hasExclusion('.env'), 'build.files исключает файлы окружения .env');
t(hasExclusion('backups'), 'build.files исключает папку бэкапов backups');
t(hasExclusion('tests'), 'build.files исключает тесты');

// 2. Проверка конфигурации pkg (если используется)
if (pkg.pkg) {
    t(Array.isArray(pkg.pkg.scripts), 'pkg.scripts определен');
    t(Array.isArray(pkg.pkg.assets), 'pkg.assets определен');
    const pkgAssets = pkg.pkg.assets || [];
    t(!pkgAssets.some(a => isSecretPath(a)), 'pkg.assets не включает секретные файлы');
}

// 3. Проверка готового дистрибутива в dist (если собран)
const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
    const distEntries = fs.readdirSync(distDir);
    const exeFiles = distEntries.filter(f => f.endsWith('.exe'));
    const zipFiles = distEntries.filter(f => f.endsWith('.zip'));

    if (exeFiles.length > 0) {
        t(true, `Обнаружен бинарник .exe в dist: ${exeFiles[0]}`);
    }
    if (zipFiles.length > 0) {
        t(true, `Обнаружен portable archive .zip в dist: ${zipFiles[0]}`);
    }

    const shaFile = path.join(distDir, 'SHA256SUMS.txt');
    t(fs.existsSync(shaFile), 'Файл контрольных сумм SHA256SUMS.txt сформирован');
}

console.log(fail ? `ИТОГ: провалов ${fail}` : 'ИТОГ: все проверки безопасности сборщика пройдены');
process.exit(fail ? 1 : 0);
