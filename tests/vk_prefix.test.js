require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// VK-команды на префиксе из settings.prefix (тот же, что в TG) и счётчик событий long poll.
// Сеть только через заглушки, токен фиктивный. Запуск: unshare -rn node tests/vk_prefix.test.js
const fs = require('fs');
const path = require('path');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `\n     ${detail}` : ''}`); };
const ROOT = path.join(__dirname, '..');
const OWNER = 42;

(async () => {
    delete process.env.VK_USER_TOKEN;
    const VkClient = require(path.join(ROOT, 'vk_client.js'));
    const sent = [];
    const axios = { create: () => ({
        post: async (url, body) => { sent.push(String(url)); return { data: { response: 1 } }; },
        get: async () => ({ data: {} }),
    }) };
    const make = (bot, cfg = {}) => {
        const logs = [];
        const conf = typeof VkClient.configFor === 'function' ? VkClient.configFor(bot, cfg) : cfg;
        const c = new VkClient(bot, { userToken: 'TEST', proxy: '', ...conf }, { axios, log: (...a) => logs.push(a.join(' ')), sleep: async () => {} });
        c.http = c.createHttp(); c.ownerId = OWNER; c.running = true;
        const calls = [];
        c.registerCommand('команды', async () => { calls.push('команды'); });
        return { c, calls, logs };
    };
    const msg = (text) => ({ platform: 'vk', messageId: 1, peerId: 2000000115, fromId: OWNER, out: true, text });

    // 1. префикс из settings.prefix: ‘команды срабатывает, *команды игнорируется
    {
        const t = make({ settings: { prefix: '‘' } }, {});
        await t.c.handleMessage(msg('‘команды'));
        const a = t.calls.length;
        await t.c.handleMessage(msg('*команды'));
        check('1. settings.prefix «‘»: ‘команды срабатывает, *команды игнорируется', a === 1 && t.calls.length === 1,
            `префикс клиента «${t.c.config.prefix}», вызовов после ‘команды: ${a}, после *команды: ${t.calls.length}`);
    }

    // 2. смена префикса (команда префикс / перечитывание settings.json) доходит до VK
    {
        const t = make({ settings: { prefix: '‘' } }, {});
        const ok = typeof t.c.setPrefix === 'function';
        if (ok) t.c.setPrefix('!');
        await t.c.handleMessage(msg('!команды'));
        await t.c.handleMessage(msg('‘команды'));
        if (ok) { t.c.setPrefix(''); t.c.setPrefix(null); }
        check('2. setPrefix(«!»): !команды срабатывает, старый ‘ нет, пустой префикс не принимается',
            ok && t.calls.length === 1 && t.c.config.prefix === '!', `setPrefix: ${ok}, вызовов: ${t.calls.length}, префикс «${t.c.config.prefix}»`);
    }

    // 3. без settings.prefix остаётся прежнее поведение (vk.prefix или «*»)
    {
        const t1 = make({}, {}); await t1.c.handleMessage(msg('*команды'));
        const t2 = make({ settings: {} }, { prefix: '#' }); await t2.c.handleMessage(msg('#команды'));
        check('3. без settings.prefix: «*» по умолчанию, vk.prefix из конфига работает', t1.calls.length === 1 && t2.calls.length === 1);
    }

    // 4. script.js: VK-клиент создаётся с префиксом из настроек и получает его при смене
    {
        const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
        const create = /new VkClient\(bot, VkClient\.configFor\(bot, appConfig\.vk \|\| \{\}\)\)/.test(src);
        const change = /this\.settings\.prefix = newPrefix;[\s\S]{0,120}this\.vkClient\.setPrefix\(newPrefix\)/.test(src);
        const reload = /this\.settings\.prefix = settingsData\.prefix \|\| '!';\s*if \(this\.vkClient\) this\.vkClient\.setPrefix\(this\.settings\.prefix\)/.test(src);
        check('4. script.js: configFor при создании, setPrefix в changePrefix и loadSettings', create && change && reload, `создание ${create}, смена ${change}, перечитывание ${reload}`);
    }

    // 5. счётчик событий long poll: растёт, в лог пишется без текста
    {
        const t = make({ settings: { prefix: '‘' } }, {});
        let n = 0;
        t.c.lp = { server: 'api.vk.com/ruim1', key: 'k', ts: 1 };
        t.c.http.get = async () => {
            n++;
            if (n === 1) return { data: { ts: 2, updates: [[4, 10, 2, 2000000115, 0, 'секретный текст', {}], [4, 11, 2, 2000000115, 0, '‘команды', {}]] } };
            t.c.running = false; return { data: { ts: 3, updates: [] } };
        };
        await t.c.pollLoop();
        const ev = t.c.status.events;
        const line = t.logs.find((l) => l.includes('VK LP: событий'));
        const leak = t.logs.some((l) => l.includes('секретный') || l.includes('2000000115'));
        check('5. счётчик событий LP: 2 события, строка в логе без текста и peer', ev === 2 && !!line && !leak && t.calls.length === 1,
            `events=${ev}, строка: ${line || 'нет'}, утечка текста: ${leak}`);
    }

    // 6. /api/stats отдаёт счётчик событий VK без текста сообщений
    {
        const src = fs.readFileSync(path.join(ROOT, 'web_interface.js'), 'utf8');
        const m = src.match(/this\.app\.get\('\/api\/stats'[\s\S]*?\n\s*\}\);/);
        const ok = !!m && /vkEvents:\s*this\.bot\.vkClient \? this\.bot\.vkClient\.status\.events : null/.test(m[0]) && !/lpCache|\.text\b/.test(m[0]);
        check('6. /api/stats: vkEvents из status.events, без lpCache и текста', ok);
    }

    const fails = results.filter((r) => !r).length;
    console.log(fails ? `ИТОГ: FAIL ${fails} из ${results.length}` : `ИТОГ: все ${results.length} OK`);
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL исключение:', e.message); process.exit(1); });
