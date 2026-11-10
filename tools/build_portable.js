/**
 * Скрипт сборки Portable-версии LP-bot (батник + скрипты + чистые зависимости)
 * Результат: dist/LP-bot-v<version>-portable.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { version } = require('../package.json');
const { isSecretPath } = require('../secret_files.js');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const stageDir = path.join(distDir, 'portable-stage');
const zipName = `LP-bot-v${version}-portable.zip`;
const zipPath = path.join(distDir, zipName);

console.log(`[portable-build] Сборка Portable-версии LP-bot v${version}...`);

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

// 1. Копирование основных файлов
const filesToCopy = [
    'main.js',
    'script.js',
    'paths.js',
    'vk_client.js',
    'web_interface.js',
    'tg_web_dc.js',
    'secret_files.js',
    'start.bat',
    'package.json',
    'package-lock.json',
    'config.example.json',
    'settings.example.json',
    'requirements.txt',
    'README.md',
    'ЗАПУСК.txt'
];

for (const file of filesToCopy) {
    const src = path.join(rootDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(stageDir, file));
    }
}

// 2. Копирование директорий (docs и ТЗ строго исключены из дистрибутива)
const dirsToCopy = ['gui', 'views', 'public', 'modules', 'assets'];
for (const dir of dirsToCopy) {
    const src = path.join(rootDir, dir);
    if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(stageDir, dir), {
            recursive: true,
            filter: (srcPath) => {
                const rel = path.relative(rootDir, srcPath);
                if (/^(?:docs|ТЗ)(?:[/\\]|$)/i.test(rel)) return false;
                return !isSecretPath(rel) && !rel.includes('.git');
            }
        });
    }
}

// 3. Создание стартового батника с автосозданием конфигов при первом запуске
const startBatContent = `@echo off
chcp 65001 >nul
title LP-bot v${version}
echo ========================================================
echo               LP-bot Portable v${version}
echo ========================================================
echo.
if not exist config.json (
    echo [INFO] Первый запуск: создаем config.json из образца...
    copy config.example.json config.json >nul
)
if not exist settings.json (
    echo [INFO] Первый запуск: создаем settings.json из образца...
    copy settings.example.json settings.json >nul
)
echo [INFO] Запуск бота через main.js...
node main.js
pause
`;
fs.writeFileSync(path.join(stageDir, 'start_portable.bat'), startBatContent, 'utf8');

// 4. Проверка на утечку секретов
function verifyNoSecrets(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(stageDir, full);
        if (isSecretPath(rel)) {
            throw new Error(`CRITICAL SECURITY FAILURE: Секретный файл обнаружен в portable-сборке: ${rel}`);
        }
        if (entry.isDirectory()) {
            verifyNoSecrets(full);
        }
    }
}
verifyNoSecrets(stageDir);
console.log('[portable-build] Security-аудит stage пройден: 0 секретов.');

// 5. Упаковка в zip через PowerShell
if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

console.log(`[portable-build] Архивация в ${zipName}...`);
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`, {
    stdio: 'inherit'
});

// Очистка stage
fs.rmSync(stageDir, { recursive: true, force: true });

const stats = fs.statSync(zipPath);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`[portable-build] Готово: ${zipPath} (${sizeMb} МБ)`);
