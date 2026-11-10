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
t(hasExclusion('docs'), 'build.files исключает приватную документацию docs');
t(hasExclusion('ТЗ'), 'build.files исключает внутренние файлы ТЗ');

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
    const zipFiles = distEntries.filter(f => f.endsWith('.zip') && f.includes(pkg.version));

    if (exeFiles.length > 0) {
        t(true, `Обнаружен бинарник .exe в dist: ${exeFiles[0]}`);
    }
    if (zipFiles.length > 0) {
        t(true, `Обнаружен актуальный portable archive .zip в dist: ${zipFiles[0]}`);
        for (const zip of zipFiles) {
            const zipBuf = fs.readFileSync(path.join(distDir, zip));
            const hasDocs = zipBuf.includes(Buffer.from('docs/')) || zipBuf.includes(Buffer.from('docs\\'));
            const hasTz = zipBuf.includes(Buffer.from('ТЗ/')) || zipBuf.includes(Buffer.from('ТЗ\\'));
            t(!hasDocs, `${zip} гарантированно не содержит приватную папку docs`);
            t(!hasTz, `${zip} гарантированно не содержит внутреннюю папку ТЗ`);
        }
    }

    const asarPath = path.join(distDir, 'win-unpacked', 'resources', 'app.asar');
    if (fs.existsSync(asarPath)) {
        const asarBuf = fs.readFileSync(asarPath);
        let asarDocs = false;
        let asarTz = false;
        try {
            const size = asarBuf.readUInt32LE(12);
            const header = JSON.parse(asarBuf.slice(16, 16 + size).toString('utf8'));
            asarDocs = Boolean(header.files && header.files.docs);
            asarTz = Boolean(header.files && header.files['ТЗ']);
        } catch {
            asarDocs = asarBuf.includes(Buffer.from('PROJECT.md'));
            asarTz = asarBuf.includes(Buffer.from('ТЗ.sha256'));
        }
        t(!asarDocs, 'app.asar гарантированно не содержит приватную папку docs');
        t(!asarTz, 'app.asar гарантированно не содержит внутреннюю папку ТЗ');
    }

    const shaFile = path.join(distDir, 'SHA256SUMS.txt');
    t(fs.existsSync(shaFile), 'Файл контрольных сумм SHA256SUMS.txt сформирован');
}

console.log(fail ? `ИТОГ: провалов ${fail}` : 'ИТОГ: все проверки безопасности сборщика пройдены');
process.exit(fail ? 1 : 0);
