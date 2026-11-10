// Проверка: веб-панель по умолчанию слушает только 127.0.0.1 и не принимает подключения с внешнего интерфейса.
// Нужны node_modules (express, ws). Сеть наружу не используется: подключения только к адресам этого компьютера.
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const WebInterface = require(path.join(__dirname, '..', 'web_interface.js'));

let fail = 0;
const t = (ok, msg) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', msg); };

const bot = { settings: { prefix: '*', triggers: new Map(), timers: new Map(), templates: new Map(), customValues: {}, deepseek: {} }, commands: {}, isRunning: true, startTime: new Date() };

const externalIPv4 = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address)[0];

const tryConnect = (host, port) => new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (r) => { s.destroy(); resolve(r); };
    s.setTimeout(1500, () => done('timeout'));
    s.on('connect', () => done('connected'));
    s.on('error', (e) => done(e.code || 'error'));
});

(async () => {
    // 1. По умолчанию (host не передан)
    const wi = new WebInterface(bot, null, 0);
    t(wi.host === '127.0.0.1', `host по умолчанию = ${wi.host}`);
    await wi.start();
    const addr = wi.server.address();
    t(addr.address === '127.0.0.1', `сервер слушает ${addr.address}:${addr.port} (ожидается 127.0.0.1)`);
    t(await tryConnect('127.0.0.1', addr.port) === 'connected', 'подключение к 127.0.0.1 проходит');
    if (externalIPv4) {
        const r = await tryConnect(externalIPv4, addr.port);
        t(r !== 'connected', `подключение к внешнему интерфейсу ${externalIPv4} не проходит (${r})`);
    } else {
        console.log('SKIP подключение к внешнему интерфейсу: у машины нет внешнего IPv4');
    }
    wi.stop();

    // 2. Пустой host (например, panelHost: "" в config.json) тоже даёт 127.0.0.1
    const wiEmpty = new WebInterface(bot, null, 0, '');
    t(wiEmpty.host === '127.0.0.1', 'пустой host → 127.0.0.1');

    // 3. Контроль: явный 0.0.0.0 открывает панель наружу, то есть проверка выше действительно ловит внешний интерфейс
    if (externalIPv4) {
        const wiOpen = new WebInterface(bot, null, 0, '0.0.0.0');
        await wiOpen.start();
        const r = await tryConnect(externalIPv4, wiOpen.server.address().port);
        t(r === 'connected', `контроль: с host 0.0.0.0 внешний интерфейс доступен (${r})`);
        wiOpen.stop();
    }

    // 4. script.js передаёт panelHost из config.json в панель, по умолчанию 127.0.0.1
    const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    t(src.includes('new WebInterface(this, null, 3001, this.panelHost)'), 'script.js: панель создаётся с this.panelHost');
    t(src.includes("bot.panelHost = appConfig.panelHost || '127.0.0.1';"), "script.js: panelHost берётся из config.json, по умолчанию '127.0.0.1'");

    console.log(fail ? `ИТОГ: провалов ${fail}` : 'ИТОГ: все тесты пройдены');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
