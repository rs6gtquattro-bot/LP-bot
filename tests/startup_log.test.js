require('./_no_network.js')({ strict: true }); // без сети, иначе FAIL; обход LP_TEST_ALLOW_NET не действует (см. tests/_no_network.js)
// Проверка: при старте script.js не печатает API ID и хвост API Hash.
// Копия проекта запускается во временной папке с фиктивными ключами на 6 секунд и гасится.
// Запускать без сети (unshare -rn): Telegram и VK при этом недоступны, наружу ничего не уходит.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

let fail = 0;
const t = (ok, msg) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', msg); };

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-startlog-'));
fs.cpSync(root, tmp, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git|bot_database\.sqlite.*|session\.txt|config\.json|settings\.json)$/.test(src) });
const nm = process.env.NODE_PATH || path.join(root, 'node_modules');

const FAKE_ID = '98765432';
const FAKE_HASH = 'deadbeef00000000000000000000c0de';
const env = { ...process.env, TELEGRAM_API_ID: FAKE_ID, TELEGRAM_API_HASH: FAKE_HASH, NODE_PATH: nm };
delete env.VK_USER_TOKEN;

const r = spawnSync(process.execPath, ['script.js'], { cwd: tmp, env, timeout: 6000, killSignal: 'SIGKILL', encoding: 'utf8', input: '' });
const out = (r.stdout || '') + (r.stderr || '');
fs.rmSync(tmp, { recursive: true, force: true });

t(out.includes('Запуск с параметрами'), 'script.js дошёл до печати параметров запуска');
t(/- API ID: задан/.test(out), 'вместо API ID печатается «задан»');
t(/- API Hash: задан/.test(out), 'вместо API Hash печатается «задан»');
t(!out.includes(FAKE_ID), 'значения API ID в выводе нет');
t(!out.includes(FAKE_HASH.slice(-4)), 'хвоста API Hash (последние 4 символа) в выводе нет');
t(!out.includes(FAKE_HASH), 'полного API Hash в выводе нет');

console.log(fail ? `ИТОГ: провалов ${fail}` : 'ИТОГ: все тесты пройдены');
process.exit(fail ? 1 : 0);
