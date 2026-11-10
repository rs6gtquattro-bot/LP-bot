// Полный раннер тестового сьюта LP-bot для Windows и Linux
const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
    { name: 'auth', file: 'auth.test.js', desc: 'Авторизация Telegram (сессия валидна / новая / протухла)' },
    { name: 'trigger-time', file: 'trigger-time.test.js', desc: 'Разбор времени и расписаний триггеров' },
    { name: 'vk_client', file: 'vk_client.test.js', desc: 'VK-клиент (токен, прокси, капча, rate-limit 3 rps)' },
    { name: 'vk_commands', file: 'vk_commands.test.js', desc: '40 команд VK, мосты вк_/тг_, уровни доступа' },
    { name: 'tg_ws', file: 'tg_ws.test.js', desc: 'Telegram WebSocket web-DC (только *.web.telegram.org:443)' },
    { name: 'startup_log', file: 'startup_log.test.js', desc: 'Логирование старта (отсутствие утечки API ID/Hash)' },
    { name: 'secret_files', file: 'secret_files.test.js', desc: 'Защита секретных файлов (8.3 имена, SQLite WAL, git)' },
    { name: 'vk_proxy_failclosed', file: 'vk_proxy_failclosed.test.js', desc: 'Принцип Fail-Closed (отказ без прокси)' },
    { name: 'vk_prefix', file: 'vk_prefix.test.js', desc: 'Префикс VK из settings.prefix и счетчик LP' },
    { name: 'vk_prefix_html', file: 'vk_prefix_html.test.js', desc: 'Семейство апострофов, HTML-декодер, ReDoS защита' },
    { name: 'security_audit', file: 'security_audit.test.js', desc: 'Security-аудит (ADS, Path Traversal, prototype)' },
    { name: 'core', file: 'core.test.js', desc: 'Модульное ядро main.js (26 тестов, изоляция, emit)' },
    { name: 'security_auth', file: 'security_auth.test.js', desc: 'Авторизация владельца isOwnerMessage, RCE блок, удаление бомбы/пуша' },
    { name: 'security_panel', file: 'security_panel.test.js', desc: 'Защита веб-панели: Bearer-токен, CSRF Origin, CSWSH' },
    { name: 'registry', file: 'registry.test.js', desc: 'Слепок реестра команд TG (40) и VK (47)' },
    { name: 'panel_host', file: 'panel_host.test.js', desc: 'Привязка веб-панели к 127.0.0.1 (Express + WS)' }
];

console.log('===============================================================');
console.log('       ПОЛНЫЙ ПРОГОН ТЕСТОВОГО СЬЮТА LP-BOT (QA LEAD)          ');
console.log('===============================================================\n');

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

const startTime = Date.now();

for (const t of TESTS) {
    process.stdout.write(`[RUN] ${t.name.padEnd(22)} (${t.desc})... `);
    const testPath = path.join(__dirname, t.file);
    const res = spawnSync(process.execPath, [testPath], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, VK_USER_TOKEN: '', TELEGRAM_API_ID: '', TELEGRAM_API_HASH: '' },
        encoding: 'utf8'
    });

    if (res.status === 0) {
        console.log('✅ OK');
        totalPassed++;
    } else {
        console.log('❌ FAIL');
        totalFailed++;
        failures.push({ name: t.name, file: t.file, output: res.stdout + '\n' + res.stderr });
    }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n===============================================================');
console.log(`ИТОГИ ПРОГОНА: Всего сьютов: ${TESTS.length} | Успешно: ${totalPassed} | Ошибок: ${totalFailed}`);
console.log(`Время выполнения: ${totalTime} сек`);
console.log('===============================================================');

if (totalFailed > 0) {
    console.log('\nДЕТАЛИЗАЦИЯ ПАДЕНИЙ:');
    for (const f of failures) {
        console.log(`\n--- СЬЮТ: ${f.name} (${f.file}) ---`);
        console.log(f.output.trim());
    }
    process.exit(1);
} else {
    console.log('\n🏆 ВСЕ ТЕСТЫ СЬЮТА ВЫПОЛНЕНЫ НА 100% ЗЕЛЁНЫЙ РЕЗУЛЬТАТ!');
    process.exit(0);
}
