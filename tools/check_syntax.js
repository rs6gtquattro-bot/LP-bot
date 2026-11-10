/**
 * tools/check_syntax.js
 * Валидатор синтаксиса всех JS файлов ядра, модулей и утилит LP-bot.
 * Поддерживает модульный этап 6 (автоматически сканирует modules/** /*.js, корректно обрабатывает удаление script.js).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

// Список потенциальных корневых скриптов
const candidateRootFiles = [
    'main.js',
    'script.js',
    'vk_client.js',
    'web_interface.js',
    'tg_web_dc.js',
    'secret_files.js',
    'paths.js'
];

const filesToCheck = [];

// 1. Корневые файлы (если существуют)
for (const file of candidateRootFiles) {
    const full = path.join(rootDir, file);
    if (fs.existsSync(full)) {
        filesToCheck.push(full);
    }
}

// 2. Все модули в папке modules/
const modulesDir = path.join(rootDir, 'modules');
function scanModules(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            scanModules(full);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            filesToCheck.push(full);
        }
    }
}
scanModules(modulesDir);

// 3. Инструменты в tools/
const toolsDir = path.join(rootDir, 'tools');
if (fs.existsSync(toolsDir)) {
    for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
            filesToCheck.push(path.join(toolsDir, entry.name));
        }
    }
}

// 4. GUI файлы
const guiJs = path.join(rootDir, 'gui', 'gui.js');
if (fs.existsSync(guiJs)) filesToCheck.push(guiJs);

console.log(`[check-syntax] Проверка синтаксиса ${filesToCheck.length} JavaScript файлов...`);

let failed = 0;
for (const file of filesToCheck) {
    const rel = path.relative(rootDir, file);
    try {
        execSync(`node --check "${file}"`, { stdio: 'pipe' });
    } catch (err) {
        failed++;
        console.error(`❌ Ошибка синтаксиса в файле: ${rel}`);
        if (err.stderr) console.error(err.stderr.toString());
    }
}

if (failed > 0) {
    console.error(`\n[check-syntax] ПРОВАЛ: Найдено ${failed} синтаксических ошибок!`);
    process.exit(1);
} else {
    console.log(`[check-syntax] УСПЕХ: Все ${filesToCheck.length} JS файлов валидны.`);
}
