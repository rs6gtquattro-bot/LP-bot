require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// Проверка: Telegram идёт только через WebSocket-вход *.web.telegram.org:443, голых IP дата-центров нет.
// Подключение подменено заглушкой: она запоминает, куда клиент собрался подключаться, и сразу бросает ошибку.
const path = require('path');
const fs = require('fs');
const net = require('net');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { PromisedWebSockets, PromisedNetSockets } = require('telegram/extensions');
const { ConnectionTCPObfuscated } = require('telegram/network');
const { useWebTelegramDCs, webClientParams } = require(path.join(__dirname, '..', 'tg_web_dc.js'));

let fail = 0;
const t = (ok, msg) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', msg); };
const WEB = /^(pluto|venus|aurora|vesta|flora)(-1)?\.web\.telegram\.org$/;

// Клиент с теми же параметрами, что в script.js; withHelper = false — контроль без правки
const make = (sessionString = '', withHelper = true) => {
    const c = new TelegramClient(new StringSession(sessionString), 1, 'x', { connectionRetries: 1, proxy: null, useIPV6: false, ...webClientParams });
    return withHelper ? useWebTelegramDCs(c) : c;
};
const target = async (client) => {
    let seen = null;
    client._connection = class { constructor(o) { seen = o; throw new Error('stub: no network'); } };
    try { await client.connect(); } catch (e) { /* ожидаемо: заглушка */ }
    return seen;
};
// Сессия с голым IP DC 2, как её сохраняет обычный gramJS в Node
const ipSession = (dcId, ip, port) => {
    const s = new StringSession('');
    s.setDC(dcId, ip, port);
    s._authKey = { getKey: () => Buffer.alloc(256, 7) };
    return s.save();
};

(async () => {
    // 1. script.js подключает правку
    const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    const block = (src.match(/new TelegramClient\(stringSession[\s\S]*?\}\);\s*\r?\n\s*useWebTelegramDCs\(this\.telegramClient\);/) || [''])[0];
    t(!!block, 'script.js: сразу после new TelegramClient вызывается useWebTelegramDCs(this.telegramClient)');
    t(/\.\.\.webClientParams/.test(block), 'script.js: в параметрах клиента ...webClientParams');
    t(!/useWSS:\s*false/.test(block), 'script.js: useWSS: false нет');
    t(/proxy:\s*null/.test(block), 'script.js: proxy: null (gramJS не совмещает useWSS и прокси)');

    // 2. Параметры: WebSocket-транспорт
    t(webClientParams.useWSS === true, 'webClientParams.useWSS = true');
    t(webClientParams.networkSocket === PromisedWebSockets, 'webClientParams.networkSocket = PromisedWebSockets');
    t(webClientParams.connection === ConnectionTCPObfuscated, 'webClientParams.connection = ConnectionTCPObfuscated');

    // 3. Стартовый DC новой сессии
    const s1 = await target(make());
    t(s1 && s1.ip === 'vesta.web.telegram.org' && s1.port === 443, `новая сессия → ${s1 && s1.ip}:${s1 && s1.port} (ожидается vesta.web.telegram.org:443, DC 4)`);
    t(s1 && s1.socket === PromisedWebSockets, 'новая сессия → сокет PromisedWebSockets');
    const ws = new PromisedWebSockets();
    t(ws.getWebSocketLink(s1.ip, s1.port, false) === 'wss://vesta.web.telegram.org:443/apiws', `адрес WebSocket: ${ws.getWebSocketLink(s1.ip, s1.port, false)}`);

    // 4. Старая сессия с голым IP переводится на web-имя того же DC
    const s2 = await target(make(ipSession(2, '149.154.167.51', 443)));
    t(s2 && s2.ip === 'venus.web.telegram.org' && s2.dcId === 2, `сессия DC 2 с голым IP → ${s2 && s2.ip} (DC ${s2 && s2.dcId})`);

    // 5. Переходы между DC (вход по номеру, экспортные отправители): только web-имена, ни одного IP
    const c = make();
    for (const id of [1, 2, 3, 4, 5]) {
        for (const dl of [false, true]) {
            const dc = await c.getDC(id, dl);
            t(WEB.test(dc.ipAddress) && !net.isIP(dc.ipAddress) && dc.port === 443, `getDC(${id}${dl ? ', download' : ''}) → ${dc.ipAddress}:${dc.port}`);
        }
    }
    // _switchDC берёт адрес из getDC и кладёт в сессию
    const sw = make();
    sw._sender = { authKey: { setKey: async () => {} } };
    sw._disconnect = async () => {};
    sw.connect = async () => {};
    await sw._switchDC(2);
    t(sw.session.serverAddress === 'venus.web.telegram.org' && sw.session.port === 443, `_switchDC(2) → ${sw.session.serverAddress}:${sw.session.port}`);

    // 6. Контроль: без правки gramJS в Node берёт голый IP, то есть проверки выше различают варианты
    const s0 = await target(make('', false));
    t(s0 && net.isIP(s0.ip) !== 0, `контроль: без useWebTelegramDCs → ${s0 && s0.ip} (голый IP)`);

    console.log(fail ? `ИТОГ: провалов ${fail}` : 'ИТОГ: все тесты пройдены');
    process.exit(fail ? 1 : 0);
})();
