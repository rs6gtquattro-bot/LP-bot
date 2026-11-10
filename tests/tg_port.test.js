require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// Проверка: Telegram-клиент ходит на порт 443 (useWSS: true), а не на 80.
// Нужны node_modules (telegram). Сеть не используется: клиент создаётся, но connect() не вызывается.
const path = require('path');
const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

let fail = 0;
const t = (ok, msg) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', msg); };

// 1. script.js создаёт клиент с useWSS: true
const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const m = src.match(/new TelegramClient\(stringSession[\s\S]*?\}\);/);
t(!!m, 'script.js: найден вызов new TelegramClient(stringSession, ...)');
const block = m ? m[0] : '';
t(/useWSS:\s*true\b/.test(block), 'script.js: в параметрах клиента useWSS: true');
t(!/useWSS:\s*false\b/.test(block), 'script.js: useWSS: false не осталось');
t(/proxy:\s*null\b/.test(block), 'script.js: proxy: null (gramJS не даёт совмещать useWSS и прокси)');

// 2–3. Реальный gramJS: какой порт он передаёт в подключение. Подключение подменено заглушкой,
// которая запоминает ip/port и сразу бросает ошибку, поэтому в сеть ничего не уходит.
const portFor = async (useWSS) => {
    const client = new TelegramClient(new StringSession(''), 1, 'x', { connectionRetries: 1, proxy: null, useWSS });
    let seen = null;
    client._connection = class { constructor(o) { seen = o; throw new Error('stub: no network'); } };
    try { await client.connect(); } catch (e) { /* ожидаемо: заглушка */ }
    return { port: seen && seen.port, sessionPort: client.session.port };
};

(async () => {
    const on = await portFor(true);
    t(on.port === 443, `useWSS: true → порт подключения ${on.port} (ожидается 443)`);
    t(on.sessionPort === 443, `useWSS: true → порт DC в сессии ${on.sessionPort} (ожидается 443)`);
    const off = await portFor(false);
    t(off.port === 80, `контроль: useWSS: false → порт подключения ${off.port} (ожидается 80), то есть проверка различает варианты`);

    // 4. Подключение в gramJS действительно берёт порт из useWSS
    const lib = fs.readFileSync(require.resolve('telegram/client/TelegramClient.js'), 'utf8');
    t(lib.includes('port: this.useWSS ? 443 : 80'), 'gramJS: порт подключения = useWSS ? 443 : 80');

    console.log(fail ? `ИТОГ: провалов ${fail}` : 'ИТОГ: все тесты пройдены');
    process.exit(fail ? 1 : 0);
})();
