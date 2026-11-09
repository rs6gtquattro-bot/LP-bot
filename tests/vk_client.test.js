// Тесты vk_client.js по критериям приёмки ТЗ (п. 9). Сеть только через заглушки:
// реальный axios, tor и VK не используются, токен фиктивный.
// Запуск: node tests/vk_client.test.js
const Module = require('module');
const path = require('path');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `\n     ${detail}` : ''}`); };
const realExit = process.exit;

// Заглушка axios: записывает каждый запрос и отвечает по сценарию.
function fakeAxios(responder) {
    const log = { created: [], requests: [] };
    return {
        log,
        create(opts) {
            log.created.push(opts);
            const inst = {
                post: async (url, body) => { log.requests.push({ via: opts, method: 'POST', url, body }); return { data: await responder('POST', url, body) }; },
                get: async (url) => { log.requests.push({ via: opts, method: 'GET', url }); return { data: await responder('GET', url) }; },
            };
            return inst;
        },
    };
}
const methodOf = (url) => url.replace('https://api.vk.com/method/', '');

(async () => {
    delete process.env.VK_USER_TOKEN;

    // 1. require без токена не падает и не тянет сетевые модули
    const loaded = [];
    const origLoad = Module._load;
    Module._load = function (req, ...rest) { loaded.push(req); return origLoad.call(this, req, ...rest); };
    let VkClient, err1 = null;
    try { VkClient = require(path.join(__dirname, '..', 'vk_client.js')); new VkClient({}, {}); } catch (e) { err1 = e; }
    Module._load = origLoad;
    const net = loaded.filter((m) => /axios|socks|http|net|tls/.test(m));
    check('1. require и new VkClient без токена: не падает, сетевые модули не загружены', !err1 && net.length === 0, `загружено: [${loaded.join(', ')}]`);

    // 2. без токена start() не стартует, одна строка в лог, запросов нет
    {
        const ax = fakeAxios(() => { throw new Error('сеть недопустима'); });
        const lines = [];
        const c = new VkClient({}, {}, { axios: ax, log: (...a) => lines.push(a.join(' ')) });
        const r = await c.start();
        check('2. без токена: start() = false, одна строка лога, 0 запросов', r === false && lines.length === 1 && ax.log.requests.length === 0, `лог: ${lines[0]}`);
    }

    // 3. все запросы через прокси из конфига
    {
        const agents = [];
        const ax = fakeAxios((m, url) => {
            if (m === 'POST' && methodOf(url) === 'users.get') return { response: [{ id: 42 }] };
            if (m === 'POST' && methodOf(url) === 'messages.getLongPollServer') return { response: { server: 'lp.vk.test/x', key: 'k', ts: 1 } };
            if (m === 'GET') { c.stop(); return { ts: 2, updates: [] }; }
            return { response: 1 };
        });
        const c = new VkClient({}, { userToken: 'TEST', proxy: 'socks5h://127.0.0.1:9050' }, {
            axios: ax, log: () => {}, createProxyAgent: (u) => { const a = { fakeAgent: u }; agents.push(a); return a; },
        });
        await c.start(); await c.pollPromise;
        const allViaProxy = ax.log.requests.length > 0 && ax.log.requests.every((r) => r.via.httpsAgent === agents[0] && r.via.httpAgent === agents[0] && r.via.proxy === false);
        check('3. прокси: агент создан из vk.proxy, все запросы (API и long poll) через него', agents.length === 1 && agents[0].fakeAgent === 'socks5h://127.0.0.1:9050' && allViaProxy,
            `запросы: ${ax.log.requests.map((r) => r.method + ' ' + (r.method === 'GET' ? 'a_check' : methodOf(r.url))).join(', ')}`);
    }

    // 4. капча: бэкофф с ростом, без перезапуска процесса
    {
        process.exit = () => { throw new Error('process.exit вызван'); };
        let clk = 0; // часы-заглушка: паузы двигают время, реальный Date.now не нужен
        let captchas = 2;
        const ax = fakeAxios(() => (captchas-- > 0 ? { error: { error_code: 14, error_msg: 'Captcha needed' } } : { response: 'ok' }));
        const sleeps = [];
        const c = new VkClient({}, { userToken: 'TEST', proxy: '' }, { axios: ax, log: () => {}, now: () => clk, sleep: async (ms) => { sleeps.push(ms); clk += ms; } });
        c.http = c.createHttp();
        const r = await c.api('messages.send', {});
        check('4а. капча 2 раза подряд: паузы 60 с и 120 с, затем успешный ответ', r === 'ok' && JSON.stringify(sleeps) === '[60000,120000]' && c.captchaStreak === 0, `паузы: ${sleeps.join(', ')} мс, запросов: ${ax.log.requests.length}`);

        const ax2 = fakeAxios(() => ({ error: { error_code: 14, error_msg: 'Captcha needed' } }));
        const sleeps2 = [];
        const c2 = new VkClient({}, { userToken: 'TEST', proxy: '' }, { axios: ax2, log: () => {}, now: () => clk, sleep: async (ms) => { sleeps2.push(ms); clk += ms; } });
        c2.http = c2.createHttp();
        let e2 = null; try { await c2.api('messages.send', {}); } catch (e) { e2 = e; }
        check('4б. капча без конца: 3 паузы (60/120/240 с), потом ошибка VK 14, процесс жив', e2 && e2.code === 14 && JSON.stringify(sleeps2) === '[60000,120000,240000]', `паузы: ${sleeps2.join(', ')} мс, ошибка: ${e2 && e2.message}`);
        process.exit = realExit;
    }

    // 5. префикс и неизвестная команда
    {
        const sent = [];
        const ax = fakeAxios((m, url, body) => { if (['messages.send', 'messages.edit'].includes(methodOf(url))) sent.push(Object.fromEntries(new URLSearchParams(body))); return { response: 1 }; });
        const c = new VkClient({}, { userToken: 'TEST', proxy: '', trustedIds: [777] }, { axios: ax, log: () => {} });
        c.http = c.createHttp(); c.ownerId = 42;
        const pinged = [];
        c.registerCommand('пинг', async ({ msg }) => pinged.push(msg.messageId));
        const msg = (text, extra = {}) => ({ platform: 'vk', messageId: 1, peerId: 2000000115, fromId: 42, out: true, text, ...extra });

        const r1 = await c.handleMessage(msg('пинг'));
        check('5а. без префикса: игнор, 0 отправок', r1 === false && sent.length === 0 && pinged.length === 0);

        await c.handleMessage(msg('*пинг', { messageId: 7 }));
        check('5б. *пинг: вызвана зарегистрированная команда', JSON.stringify(pinged) === '[7]' && sent.length === 0);

        await c.handleMessage(msg('*абракадабра 1 2'));
        const expected = "❌ Команда '*абракадабра' не найдена\nДля TG команд: *тг_абракадабра";
        check('5в. неизвестная команда: ответ из ТЗ п. 5.3 в тот же чат (своё сообщение редактируется, как в TG)', sent.length === 1 && sent[0].message === expected && sent[0].peer_id === '2000000115', `ответ: ${JSON.stringify(sent[0] && sent[0].message)}`);

        sent.length = 0;
        await c.handleMessage(msg('*абракадабра', { out: false, fromId: 555 }));
        await c.handleMessage(msg('*абракадабра', { out: false, fromId: 777 }));
        check('5г. чужой не отвечаем, доверенному (trustedIds) отвечаем', sent.length === 1);

        const n = c.normalize([4, 10, 2, 2000000115, 0, '*тест', { from: '42' }]);
        check('5д. normalize события 4 → объект как у TG', n && n.platform === 'vk' && n.text === '*тест' && n.out === true && n.peerId === 2000000115 && n.messageId === 10, JSON.stringify(n));
    }

    // 6. лимит запросов: не больше 3 в любом окне 1 с
    {
        let clock = 0;
        const stamps = [];
        const ax = fakeAxios(() => { stamps.push(clock); return { response: 1 }; });
        const c = new VkClient({}, { userToken: 'TEST', proxy: '' }, { axios: ax, log: () => {}, now: () => clock, sleep: async (ms) => { clock += ms; } });
        c.http = c.createHttp();
        for (let i = 0; i < 10; i++) await c.api('messages.send', {});
        let maxInWindow = 0;
        for (const t of stamps) maxInWindow = Math.max(maxInWindow, stamps.filter((s) => s >= t && s < t + 1000).length);
        check('6. лимит: 10 запросов подряд, в любом окне 1 с не больше 3', maxInWindow === 3 && stamps.length === 10, `моменты (мс): ${stamps.join(', ')}`);
    }

    const fail = results.filter((x) => !x).length;
    console.log(fail ? `ИТОГ: ${fail} провал(ов) из ${results.length}` : `ИТОГ: все тесты пройдены (${results.length})`);
    realExit(fail ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); realExit(1); });
