require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// Проверка: файловые команды бота (TG ‘код …’ и VK ‘код показать’) не читают и не меняют секретные файлы.
// Работает на временной папке с поддельными файлами; script.js не запускается, сеть не нужна.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { isSecretPath, resolveBotPath, resolveRestore } = require(path.join(__dirname, '..', 'secret_files.js'));

let fail = 0, ok = 0;
const t = (cond, msg) => { if (cond) ok++; else fail++; console.log(cond ? 'OK  ' : 'FAIL', msg); };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-'));
const FAKE = 'FAKE-SECRET-VALUE-0000';
for (const f of ['session.txt', 'config.json', 'settings.json', '.env', 'a.session', 'bot_database.sqlite', 'script.js', 'README.md']) {
    fs.writeFileSync(path.join(base, f), f === 'script.js' || f === 'README.md' ? 'ok' : FAKE);
}
fs.mkdirSync(path.join(base, 'backups'));
fs.writeFileSync(path.join(base, 'backups', 'settings.json_1700000000000.backup'), FAKE);
fs.writeFileSync(path.join(base, 'backups', 'script.js_1700000000000.backup'), 'ok');
fs.mkdirSync(path.join(base, '.git'));
fs.writeFileSync(path.join(base, '.git', 'config'), FAKE);

// 1. TG: validateFilePath (через resolveBotPath) закрывает секреты в любом написании
const blocked = ['session.txt', 'config.json', 'settings.json', '.env', '.env.local', 'a.session', 'congif.json',
    'Session.TXT', 'CONFIG.json', 'Settings.Json', './session.txt', 'sub/session.txt', 'sub\\config.json',
    '/session.txt', '.git/config', '.git', 'session.txt/x.js', 'session~1.txt', 'config~1.json', 'SESSIO~1.TXT', 'sub/SETTIN~2.JSO'];
for (const p of blocked) t(throws(() => resolveBotPath(base, p)), `TG: доступ к «${p}» запрещён`);

// 1б. общий список: WAL/SHM SQLite и 8.3-имена — секреты (VK их не режет по расширению)
for (const p of ['bot_database.sqlite-wal', 'bot_database.sqlite-shm', 'db.SQLITE-WAL', 'session~1.txt', 'sub\\CONFIG~1.JSO']) {
    t(isSecretPath(p), `isSecretPath(«${p}»)`);
}
for (const p of ['script.js', 'my-file.txt', 'a~b.txt']) t(!isSecretPath(p), `isSecretPath(«${p}») = нет`);

// 2. Обычные файлы бота по-прежнему доступны
for (const p of ['script.js', 'README.md', '.', 'tests/auth.test.js', 'settings.example.json', 'config.example.json']) {
    t(!throws(() => resolveBotPath(base, p)), `TG: «${p}» доступен`);
}
// старые правила на месте
t(throws(() => resolveBotPath(base, '../x.js')), 'TG: «..» запрещён');
t(throws(() => resolveBotPath(base, 'bot_database.sqlite')), 'TG: .sqlite запрещён');

// 3. TG ‘код восстановить’: только имя без пути, поверх секретов нельзя
t(throws(() => resolveRestore(base, 'settings.json_1700000000000.backup')), 'restore: поверх settings.json запрещено');
t(throws(() => resolveRestore(base, 'Session.txt_1.backup')), 'restore: поверх session.txt запрещено');
t(throws(() => resolveRestore(base, '../../x.js_1.backup')), 'restore: путь с .. запрещён');
t(throws(() => resolveRestore(base, 'sub/script.js_1.backup')), 'restore: путь с / запрещён');
const r = resolveRestore(base, 'script.js_1700000000000.backup');
t(r.originalPath === path.join(base, 'script.js') && r.backupPath === path.join(base, 'backups', 'script.js_1700000000000.backup'), 'restore: обычный бэкап script.js работает');

// 4. Бэкапы секретных файлов тоже секрет (VK ‘код показать’ не проверяет расширение)
t(isSecretPath('backups/settings.json_1700000000000.backup'), 'бэкап settings.json — секрет');
t(!isSecretPath('backups/script.js_1700000000000.backup'), 'бэкап script.js — не секрет');

// 5. script.js и vk_client.js используют общий модуль
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
t(/validateFilePath\(userPath\) \{[\s\S]{0,200}return resolveBotPath\(__dirname, userPath\);/.test(src), 'script.js: validateFilePath вызывает resolveBotPath');
t(/resolveRestore\(__dirname, backupName\)/.test(src), 'script.js: restoreBackup вызывает resolveRestore');
const methods = ['showCodeFile', 'editCodeFile', 'addCodeToFile', 'createCodeFile', 'deleteCodeFile', 'showFileInfo', 'createBackup'];
for (const m of methods) {
    const body = (src.match(new RegExp(`async ${m}\\(args[\\s\\S]*?\\n\\}`)) || [''])[0];
    t(/this\.validateFilePath\(args\[0\]\)/.test(body), `script.js: ${m} проверяет путь через validateFilePath`);
}
const vsrc = fs.readFileSync(path.join(root, 'vk_client.js'), 'utf8');
t(/require\('\.\/secret_files\.js'\)/.test(vsrc) && /isSecretPath\(path\.relative\(base, full\)\)/.test(vsrc), 'vk_client.js: ‘код показать’ использует isSecretPath');

// 6. VK ‘код показать’ на деле: вызываем обработчик из vk_client.js на временной папке
const VkClient = require(path.join(root, 'vk_client.js'));
const replies = [];
const client = new VkClient({}, { proxy: '' });
const cmd = client.commands && (client.commands.get ? client.commands.get('код') : client.commands['код']);
if (cmd && typeof (cmd.handler || cmd.fn || cmd.run) === 'function') {
    const h = cmd.handler || cmd.fn || cmd.run;
    // обработчик смотрит в папку vk_client.js; проверка секрета идёт раньше проверки существования файла
    const run = async (file) => { replies.length = 0; await h({ args: ['показать', file], reply: async (x) => replies.push(x) }); return replies.join('\n'); };
    (async () => {
        for (const f of ['config.json', 'settings.json', 'session.txt', '.git/config', '.env.local', 'backups/settings.json_1.backup', 'a.session']) {
            const out = await run(f);
            t(out.includes('⛔') && !out.includes(FAKE), `VK ‘код показать ${f}’: отказ`);
        }
        const out = await run('README.md');
        t(!out.includes('⛔'), 'VK ‘код показать README.md’: работает');
        finish();
    })().catch(e => { t(false, 'VK обработчик: ' + e.message); finish(); });
} else {
    t(false, 'VK: не нашёл обработчик команды ‘код’ в client.commands');
    finish();
}

function finish() {
    fs.rmSync(base, { recursive: true, force: true });
    console.log(fail ? `ИТОГ: провалов ${fail}` : `ИТОГ: все тесты пройдены (${ok})`);
    process.exit(fail ? 1 : 0);
}
