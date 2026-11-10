require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// Тесты команд VK (ТЗ п. 6) и межплатформенной маршрутизации (п. 5.6).
// Всё на заглушках: axios, БД, TG-клиент, таймеры. Реальный VK, tor и OpenRouter не используются.
// Запуск: node tests/vk_commands.test.js
const fs = require('fs');
const path = require('path');
const VkClient = require(path.join(__dirname, '..', 'vk_client.js'));

const results = [];
const tested = new Set();
const check = (cmd, name, ok, detail = '') => {
    [].concat(cmd).forEach((c) => c && tested.add(c));
    results.push(ok);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

const OWNER = 42, CHAT = 2000000115, DM = 555;
const USERS = {
    42: { id: 42, first_name: 'Я', last_name: 'Владелец', screen_name: 'owner' },
    555: { id: 555, first_name: 'Павел', last_name: 'Дуров', screen_name: 'durov' },
    777: { id: 777, first_name: 'Друг', last_name: 'Доверенный', screen_name: 'friend' },
};
const byScreen = (k) => Object.values(USERS).find((u) => String(u.id) === String(k) || u.screen_name === k);

function setup({ reply = null, responses = {}, trusted = {}, bot = {} } = {}) {
    const calls = [];
    let clock = 1000000, nextId = 5000;
    const timers = [];
    const db = new Map();
    const fakeDb = {
        run: (sql, p, cb) => { if (/INSERT/.test(sql)) db.set(p[0], p[1]); cb && cb(null); },
        get: (sql, p, cb) => cb(null, db.has(p[0]) ? { value: db.get(p[0]) } : undefined),
    };
    const responder = async (verb, url, body) => {
        if (verb === 'GET') { calls.push({ method: 'GET', url }); return responses.GET ? responses.GET(url) : []; }
        if (url.includes('openrouter.ai')) { calls.push({ method: 'openrouter', body }); return responses.openrouter || {}; }
        const method = url.replace('https://api.vk.com/method/', '');
        const params = Object.fromEntries(new URLSearchParams(body));
        calls.push({ method, params });
        if (responses[method]) return { response: typeof responses[method] === 'function' ? responses[method](params) : responses[method] };
        if (method === 'users.get') return { response: String(params.user_ids || '').split(',').map(byScreen).filter(Boolean) };
        if (method === 'messages.getById') return { response: { items: [reply ? { reply_message: reply } : {}] } };
        if (method === 'messages.send') return { response: nextId++ };
        return { response: 1 };
    };
    const axios = {
        create: () => ({
            post: async (url, body) => ({ data: await responder('POST', url, typeof body === 'string' ? body : JSON.stringify(body)) }),
            get: async (url) => ({ data: await responder('GET', url) }),
        }),
    };
    const c = new VkClient({ db: fakeDb, ...bot }, { userToken: 'TEST', proxy: '', trustedIds: [] }, {
        axios, log: () => {}, now: () => clock, sleep: async (ms) => { clock += ms; },
        setTimeout: (fn, ms) => timers.push({ fn, ms }), setInterval: (fn, ms) => { timers.push({ fn, ms, interval: true }); return timers.length; }, clearInterval: () => {},
    });
    c.http = c.createHttp();
    c.ownerId = OWNER;
    c.running = true;
    Object.assign(c.state.trusted, trusted);
    const run = async (text, over = {}) => {
        calls.length = 0;
        await c.handleMessage({ platform: 'vk', messageId: 100, peerId: CHAT, fromId: OWNER, out: true, text, ...over });
        return calls;
    };
    const texts = () => calls.filter((x) => ['messages.edit', 'messages.send'].includes(x.method)).map((x) => x.params.message);
    const last = () => texts().slice(-1)[0];
    const has = (method, pred = () => true) => calls.some((x) => x.method === method && pred(x.params || {}));
    return { c, calls, run, texts, last, has, timers, db, advance: (ms) => { clock += ms; } };
}

(async () => {
    // ---------- БАЗОВЫЕ ----------
    { const t = setup(); await t.run('*пинг');
      const tx = t.texts();
      check('пинг', 'пинг: «🏓 ...», затем правка на «🏓 Понг! N мс»', tx[0] === '🏓 ...' && /^🏓 Понг! \d+ мс$/.test(tx[1]) && t.calls.every((x) => x.method === 'messages.edit'), JSON.stringify(tx)); }
    { const t = setup(); await t.run('*кмд'); const a = t.last(); await t.run('*кмд 4'); const b = t.last(); await t.run('*кмд все'); const all = t.last();
      check('кмд', 'кмд: список разделов, кмд 4 — ЗАЩИТА, кмд все — все команды', /^LP Bot VK — \d+ команд, префикс \*/.test(a) && a.includes('4. ЗАЩИТА') && b.startsWith('ЗАЩИТА') && b.includes('*антимат') && [...t.c.commands.keys()].every((k) => all.includes(`*${k}`)), a); }
    { const t = setup(); await t.run('*хелп влад'); const a = t.last(); await t.run('*хелп нетакого');
      check('хелп', 'хелп [раздел]: раздел по началу названия, неизвестный — ошибка', a.startsWith('ВЛАДЕЛЕЦ') && a.includes('*вк_токен') && t.last().startsWith('❌ Раздел'), a); }
    { const t = setup(); await t.run('*триггер Привет | Здарова'); const a = t.last(); await t.run('*триггеры'); const b = t.last();
      t.calls.length = 0; await t.c.handleMessage({ platform: 'vk', messageId: 101, peerId: CHAT, fromId: DM, out: false, text: 'ну привет всем' });
      const fired = t.has('messages.send', (p) => p.message === 'Здарова' && p.reply_to === '101');
      await t.run('*дельтриггер 1'); const d = t.last(); await t.run('*дельтриггер 9');
      check(['триггер', 'триггеры', 'дельтриггер'], 'триггер / триггеры / дельтриггер: создание, список, срабатывание на входящем, удаление, сохранение в БД',
        a === '✅ Триггер #1: «привет» → «Здарова»' && b.includes('#1 «привет» → «Здарова»') && fired && d === '🗑 Триггер #1 удалён' && t.last().startsWith('❌ Триггер #9') && t.db.has('state'), JSON.stringify([a, b, fired, d])); }
    { const saved = []; const t = setup({ bot: {
        saveTemplateToDatabase: async (x) => saved.push(x),
        getAllTemplates: async () => [{ name: 'прив', content_type: 'text', used_count: 2 }],
        getTemplateFromDatabase: async (n) => (n === 'прив' ? { name: 'прив', content_type: 'text', text_content: 'Привет!' } : n === 'фото' ? { content_type: 'photo' } : null),
        updateTemplateUsage: async (n) => saved.push('used:' + n) } });
      await t.run('*шаблон прив Привет!'); const a = t.last(); await t.run('*шаблоны'); const b = t.last(); await t.run('*ш прив'); const c1 = t.last();
      await t.run('*ш фото'); const c2 = t.last(); await t.run('*ш нет');
      check(['шаблон', 'шаблоны', 'ш'], 'шаблон / шаблоны / ш: общая таблица templates бота, только текст',
        a === '💾 Шаблон "прив" сохранён' && saved[0].textContent === 'Привет!' && saved[0].contentType === 'text' && b.includes('• прив (text') && c1 === 'Привет!' && saved.includes('used:прив') && c2.startsWith('⚠️') && t.last() === '❌ Шаблон "нет" не найден', JSON.stringify([a, b, c1, c2])); }
    { const t = setup({ trusted: { 777: 1 } });
      await t.run('*доступ'); const list = t.last();
      await t.run('*доступ добавить @durov'); const add = t.last();
      await t.run('*доступ уровень 555 3'); const lvl = t.last();
      await t.run('*доступ удалить id555'); const del = t.last();
      await t.run('*доступ добавить'); const none = t.last();
      await t.run('*доступ добавить 555', { out: false, fromId: 777 }); const deny = t.texts().slice(-1)[0];
      check('доступ', 'доступ: список с screen_name (без @undefined), добавить/уровень/удалить, без ID, чужой не меняет',
        list.startsWith('📋 Доверенные VK пользователи:\n• Друг Доверенный ([id777|@friend]) [777]') && list.includes('Добавить: *доступ добавить @юзер') && !list.includes('undefined')
        && add === '✅ Павел Дуров (555) добавлен в доверенные' && lvl === '✅ Павел Дуров (555): уровень доступа 3' && del === '🗑 Павел Дуров (555) удалён из доверенных'
        && none === '❌ Укажи ID, @юзернейм или ответь на сообщение' && deny === '⛔ Менять доступ может только владелец' && !t.c.state.trusted[555], JSON.stringify([list, add, lvl, del, none, deny])); }

    // ---------- СООБЩЕНИЯ ----------
    { const t = setup({ responses: { 'messages.getHistory': { items: [{ id: 100, out: 1 }, { id: 99, out: 0 }, { id: 98, out: 1 }, { id: 97, out: 1 }, { id: 96, out: 1 }] } } });
      await t.run('*смс 2');
      const ok = t.has('messages.delete', (p) => p.message_ids === '100,98,97' && p.delete_for_all === '1');
      const t2 = setup({ reply: { id: 90, from_id: OWNER, conversation_message_id: 9 } }); await t2.run('*смс');
      check('смс', 'смс [N]: команда + N своих последних (чужие не трогает); по ответу — ещё и то сообщение', ok && t2.has('messages.delete', (p) => p.message_ids === '100,90'), JSON.stringify(t.calls.map((x) => x.method))); }
    { const t = setup(); await t.run('*фейк всем привет');
      const order = t.calls.map((x) => x.method).join(',');
      await t.run('*фейк');
      check('фейк', 'фейк [текст]: команда удаляется у всех, текст уходит обычным сообщением', order === 'messages.delete,messages.send' && t.last() === '❌ Укажи текст', order); }
    { const t = setup(); await t.run('*спам 4 ку'); const n = t.calls.filter((x) => x.method === 'messages.send' && x.params.message === 'ку').length;
      await t.run('*спам 500 ку');
      check('спам', 'спам [N] [текст]: N отправок через общий лимит, N > 50 — отказ', n === 4 && t.last().startsWith('❌ Формат'), `отправок: ${n}`); }
    { const t = setup();
      const prot = ['антимат', 'антиlink', 'антискрин', 'антифлуд', 'антибот', 'капча', 'антиспам'];
      let ok = true;
      for (const p of prot) { await t.run(`*${p} вкл`); ok = ok && t.last() === `🛡 ${p}: включено ✅` && t.c.state.protection[p] === true; }
      await t.run('*антимат выкл'); ok = ok && t.c.state.protection['антимат'] === false; await t.run('*антимат'); ok = ok && t.c.state.protection['антимат'] === true;
      check(prot, 'защита (7 команд): вкл/выкл/переключение без аргумента, сохранение в БД', ok && JSON.parse(t.db.get('state')).protection['антиlink'] === true); }
    { const t = setup(); for (const p of ['антимат', 'антиlink', 'антискрин', 'антибот', 'антифлуд', 'антиспам']) t.c.state.protection[p] = true;
      const inc = async (text, over = {}) => { t.calls.length = 0; return t.c.handleIncoming({ platform: 'vk', messageId: 200, peerId: CHAT, fromId: DM, out: false, text, ...over }); };
      const r = [await inc('го на https://example.com'), await inc('ты муда к', { fromId: 556 }), await inc('ты мудак'), await inc('', { action: 'chat_screenshot', fromId: 557 }), await inc('я бот', { fromId: -5 }), await inc('обычный текст', { fromId: 558 })];
      let flood = null; for (let i = 0; i < 6; i++) flood = await inc(`сообщение ${i}`, { fromId: 559 });
      let spam = null; for (let i = 0; i < 3; i++) spam = await inc('одно и то же', { fromId: 560 });
      check(null, 'защита в работе: link, мат, скрин, бот, флуд (6 за 10 с), спам (3 одинаковых) удаляются у всех; обычный текст не трогается',
        JSON.stringify(r) === JSON.stringify(['антиlink', null, 'антимат', 'антискрин', 'антибот', null]) && flood === 'антифлуд' && spam === 'антиспам', JSON.stringify([r, flood, spam])); }
    { const t = setup(); t.c.state.protection['капча'] = true;
      const inc = (text) => t.c.handleIncoming({ platform: 'vk', messageId: 300, peerId: DM, fromId: DM, out: false, text });
      const r1 = await inc('привет'); const q = t.calls.find((x) => x.method === 'messages.send').params.message; const answer = q.match(/(\d+) \+ (\d+)/).slice(1).map(Number).reduce((a, b) => a + b);
      const r2 = await inc('неверно'); const r3 = await inc(String(answer)); const r4 = await inc('теперь можно');
      check(null, 'капча в ЛС: вопрос новому собеседнику, без ответа его сообщения удаляются у себя, верный ответ — пропуск',
        r1 === 'капча' && /^🤖 Капча: сколько будет \d+ \+ \d+\?/.test(q) && r2 === 'капча' && r3 === 'капча_ок' && r4 === null && t.c.state.captchaPassed.includes(DM), JSON.stringify([r1, r2, r3, r4])); }
    { const t = setup({ reply: { id: 90, from_id: DM, conversation_message_id: 33 } }); await t.run('*закреп');
      const ok = t.has('messages.pin', (p) => p.conversation_message_id === '33') && t.last() === '📌 Сообщение закреплено';
      const t2 = setup(); await t2.run('*закреп');
      check('закреп', 'закреп: закрепляет сообщение из ответа; без ответа — ошибка', ok && t2.last() === '❌ Ответь на сообщение, которое нужно закрепить'); }
    { const t = setup({ responses: { 'messages.getConversations': { items: [{ conversation: { peer: { id: 1 } } }, { conversation: { peer: { id: 2 } } }] } } });
      await t.run('*прочитать'); const a = t.has('messages.markAsRead', (p) => p.peer_id === String(CHAT)) && t.last() === '✅ Прочитано';
      await t.run('*прочитать все');
      check('прочитать', 'прочитать [все]: текущий диалог или все непрочитанные', a && t.calls.filter((x) => x.method === 'messages.markAsRead').length === 2 && t.last() === '✅ Прочитано диалогов: 2'); }
    { const t = setup(); await t.run('*автоудалить 30 секрет');
      const edited = t.last() === 'секрет'; const timer = t.timers.find((x) => x.ms === 30000);
      t.calls.length = 0; await timer.fn(); await new Promise((r) => setImmediate(r));
      check('автоудалить', 'автоудалить [сек] [текст]: команда превращается в текст и удаляется у всех через N секунд', edited && timer && t.has('messages.delete', (p) => p.message_ids === '100' && p.delete_for_all === '1')); }

    // ---------- VK СПЕЦ. ----------
    { const t = setup({ responses: { 'messages.getConversationsById': { items: [{ chat_settings: { title: 'Chat Eblanov', members_count: 5 } }] } } });
      await t.run('*о_чате'); const a = t.last(); await t.run('*о_чате', { peerId: DM });
      check('о_чате', 'о_чате: «💬 <название> • ID: 2000000115» (ТЗ L31130), в ЛС — имя собеседника', a === '💬 Chat Eblanov • ID: 2000000115 • участников: 5' && t.last() === '💬 ЛС с Павел Дуров • ID: 555', a); }
    { const t = setup(); await t.run('*айди @durov'); const a = t.last(); await t.run('*айди [id555|Паша]'); const b = t.last(); await t.run('*айди');
      const t2 = setup({ reply: { id: 90, from_id: 777 } }); await t2.run('*айди');
      check('айди', 'айди [id]: «👤 Имя • vk.com/<screen>», по @, [id|], ответу; без цели — ошибка из ТЗ',
        a === '👤 Павел Дуров • vk.com/durov\n🆔 555' && b === a && t.last() === '❌ Укажи ID, @юзернейм или ответь на сообщение' && t2.last().startsWith('👤 Друг Доверенный'), JSON.stringify([a, b])); }
    { const t = setup({ responses: { 'messages.getInviteLink': { link: 'https://vk.me/join/TEST' } } }); await t.run('*инвайт'); const a = t.last(); await t.run('*инвайт', { peerId: DM });
      check('инвайт', 'инвайт: ссылка беседы; в ЛС — отказ', a === '🔗 https://vk.me/join/TEST' && t.last().startsWith('❌')); }
    { const t = setup({ responses: { 'messages.getConversationMembers': { profiles: [{ id: 42, first_name: 'Я' }, { id: 555, first_name: 'Павел' }, { id: 777, first_name: 'Друг' }] } } });
      await t.run('*упомянуть сбор');
      check('упомянуть', 'упомянуть [текст]: все участники кроме себя + текст', t.last() === '[id555|Павел], [id777|Друг]\nсбор', t.last()); }
    { const t = setup(); await t.run('*онлайн вкл'); const a = t.has('account.setOnline') && t.timers.some((x) => x.interval && x.ms === 240000) && t.c.state.online;
      await t.run('*невидимка вкл'); const b = t.has('account.setOffline') && !t.c.state.online && t.c.state.invisible;
      await t.run('*онлайн выкл'); const c1 = !t.c.state.online; await t.run('*невидимка выкл');
      check(['онлайн', 'невидимка'], 'онлайн / невидимка: setOnline с продлением раз в 4 мин, невидимка — setOffline и выключает онлайн', a && b && c1 && !t.c.state.invisible && t.last() === '👻 Невидимка: выключена ❌'); }
    { const t = setup({ responses: { GET: (url) => (url.includes('q=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0') ? [{ lat: '55.75', lon: '37.62' }] : []) } });
      await t.run('*геолокация Москва'); const ok = t.has('messages.send', (p) => p.lat === '55.75' && p.long === '37.62' && p.message === '📍 Москва');
      await t.run('*геолокация Ктотам');
      check('геолокация', 'геолокация [город]: координаты (заглушка геокодера) → messages.send с lat/long; не найден — ошибка', ok && t.last() === '❌ Город «Ктотам» не найден'); }

    // ---------- ЗАЩИТА: вк_доступ ----------
    { const t = setup(); await t.run('*вк_доступ добавить 777'); const a = t.last(); await t.run('*вк_доступ');
      check('вк_доступ', 'вк_доступ: то же, что доступ (добавить и список)', a === '✅ Друг Доверенный (777) добавлен в доверенные' && t.last().includes('[id777|@friend]')); }

    // ---------- LP LOGGER ----------
    { const t = setup(); await t.c.handleMessage({ platform: 'vk', messageId: 1, peerId: CHAT, fromId: DM, out: false, text: 'секретный план' });
      await t.c.handleMessage({ platform: 'vk', messageId: 2, peerId: CHAT, fromId: 777, out: false, text: 'другой план' });
      await t.run('*лп_поиск план'); const found = t.last();
      await t.run('*лп блок 555'); const blk = t.last(); await t.run('*лп_поиск секретный'); const after = t.last();
      await t.run('*лп разблок 555'); const unb = t.last();
      await t.run('*лп whitelist вкл'); const wl = t.last();
      await t.c.handleMessage({ platform: 'vk', messageId: 3, peerId: CHAT, fromId: 888, out: false, text: 'чужой' }); const cached = t.c.lpCache.some((m) => m.fromId === 888);
      await t.run('*лп кэш'); const cache = t.last(); await t.run('*лп кэш очистить'); const cl = t.c.lpCache.length;
      t.c.lp = { server: 'x' }; await t.run('*лп обновить'); const upd = t.c.lp === null;
      check(['лп', 'лп_поиск'], 'лп whitelist/блок/разблок/обновить/кэш и лп_поиск: кэш входящих, блок вычищает и не пишет, whitelist пропускает только своих',
        found.startsWith('🔍 «план» (2)') && blk === '🚫 555 не логируется' && after.includes('ничего не найдено') && unb === '✅ 555 снова логируется' && wl === '📒 LP whitelist: включено ✅'.replace('включено', 'включён') && !cached && /^📒 Кэш LP: \d+ сообщений/.test(cache) && cl === 0 && upd,
        JSON.stringify([found, blk, after, unb, wl, cached, cache])); }
    { const t = setup(); Object.assign(t.c.status, { connected: true, ts: 777, lastEventAt: 1000000 - 5000, errors: 2, captchas: 1 });
      await t.run('*лп_статус'); const a = t.last(); await t.run('*вк_лп_статус');
      check(['лп_статус', 'вк_лп_статус'], 'лп_статус / вк_лп_статус: подключение, ts, последнее событие, ошибки, капчи (ТЗ п. 4.3)', a === '📡 VK LP: подключён ✅\nts: 777\nПоследнее событие: 5 с назад\nОшибок: 2\nКапч: 1' && t.last() === a, a); }

    // ---------- ВЛАДЕЛЕЦ ----------
    { const t = setup({ trusted: { 777: 3 } }); t.c.state.protection['антиlink'] = true; await t.run('*адм'); const a = t.last();
      await t.run('*адм', { out: false, fromId: 777 });
      check('адм', 'адм: панель владельца; доверенному даже 3-го уровня — отказ', a.startsWith('👑 Панель владельца VK') && a.includes('Доверенных: 1') && a.includes('Защита: антиlink') && t.last().startsWith('⛔'), a); }
    { const t = setup(); t.c.token = ''; await t.run('*вк_токен'); const st = t.last();
      const tok = 'vk1.a.' + 'x'.repeat(40);
      await t.run(`*вк_токен ${tok}`);
      const deleted = t.has('messages.delete', (p) => p.message_ids === '100'); // access_token в самих запросах к API — штатно; проверяем, что токен не попал в текст сообщений
      const leaked = t.calls.some((x) => x.params && String(x.params.message || '').includes(tok));
      const saved = JSON.parse(t.db.get('state')).userToken === tok && t.c.token === tok;
      await t.run('*вк_токен мусор');
      check('вк_токен', 'вк_токен [token]: команда с токеном удаляется, токен в БД, нигде не выводится; мусор — отказ',
        st === '🔑 VK-токен: не задан' && deleted && saved && !leaked && t.last().startsWith('❌ Это не похоже'), JSON.stringify({ st, deleted, saved, leaked })); }
    { const t = setup(); await t.run('*вк_группа 12345 grouptoken'); const a = t.last(); const del = t.has('messages.delete');
      await t.run('*вк_группа'); const b = t.last(); await t.run('*вк_группа abc');
      check('вк_группа', 'вк_группа [id] [token]: сохраняется в БД, команда удаляется, токен не выводится',
        a === '✅ VK-группа 12345 сохранена, команда с токеном удалена' && del && b === '👥 VK-группа: 12345, токен задан' && !b.includes('grouptoken') && t.last().startsWith('❌ Формат')); }
    { const t = setup(); await t.run('*вк_настройки'); const a = t.last();
      check('вк_настройки', 'вк_настройки: префикс, прокси, API, токен без значения', a.includes('Префикс: *') && a.includes('Токен: задан') && !a.includes('TEST'), a); }
    { const t = setup({ bot: { botInfo: { id: 1, username: 'tgme' } } }); await t.run('*сессии');
      check('сессии', 'сессии: статус TG и VK', t.last() === '📱 Сессии\nTG: авторизован (@tgme)\nVK: запущен (id42)', t.last()); }
    { const t = setup(); await t.run('*код показать vk_client.js 1-3'); const a = t.last();
      await t.run('*код показать config.json'); const b = t.last(); await t.run('*код показать ../../etc/passwd'); const c1 = t.last(); await t.run('*код показать bot_database.sqlite');
      check('код', 'код показать: до 50 строк файла бота; config.json, сессия, БД и выход из папки — отказ',
        a.startsWith('📄 vk_client.js (1-3 из') && a.includes('1: // VK-клиент') && b.startsWith('⛔') && c1 === '❌ Можно смотреть только файлы бота' && t.last().startsWith('⛔'), JSON.stringify([a.slice(0, 60), b, c1])); }
    { const t = setup(); await t.run('*триггер а | б'); await t.run('*debug_triggers');
      check('debug_triggers', 'debug_triggers: сырой список триггеров', t.last().includes('"word":"а"') && t.last().includes('nextTriggerId: 2')); }

    // ---------- AI / OPENROUTER ----------
    { const saveEnv = process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_API_KEY;
      const t = setup({ responses: { openrouter: { choices: [{ message: { content: 'Ответ модели' } }] } } });
      await t.run('*ор привет'); const nokey = t.last();
      await t.run('*ор_ключ sk-or-TESTKEY'); const k = t.last(); const kdel = t.has('messages.delete');
      await t.run('*ор_модель openai/gpt-4o'); const m = t.last();
      await t.run('*ор как дела'); const tx = t.texts(); const req = t.calls.find((x) => x.method === 'openrouter');
      await t.run('*ор_статус'); const st = t.last(); await t.run('*ор_помощь'); const h = t.last();
      await t.run('*ор_модель плохая');
      check(['ор', 'ор_ключ', 'ор_модель', 'ор_статус', 'ор_помощь'], 'ор / ор_ключ / ор_модель / ор_статус / ор_помощь: без ключа отказ, ключ скрыт и удалён из чата, запрос с моделью, ответ правкой',
        nokey.startsWith('❌ Ключ OpenRouter не задан') && k === '✅ Ключ OpenRouter сохранён, команда с ним удалена' && kdel && m === '✅ Модель OpenRouter: openai/gpt-4o'
        && tx[0] === '🤖 Думаю...' && tx[1] === '🤖 Ответ модели' && JSON.parse(req.body).model === 'openai/gpt-4o' && st.includes('Ключ: задан') && !st.includes('TESTKEY') && st.includes('Запросов с запуска: 1')
        && h.startsWith('AI / OPENROUTER') && t.last().startsWith('❌ Модель'), JSON.stringify({ nokey, k, m, tx, st }));
      if (saveEnv !== undefined) process.env.OPENROUTER_API_KEY = saveEnv; }

    // ---------- уровни доступа ----------
    { const t = setup({ trusted: { 777: 1 } }); await t.run('*спам 2 х', { out: false, fromId: 777 }); const a = t.texts().slice(-1)[0];
      t.c.state.trusted[777] = 2; await t.run('*спам 2 х', { out: false, fromId: 777 }); const n = t.calls.filter((x) => x.method === 'messages.send' && x.params.message === 'х').length;
      check(null, 'уровни доступа: уровню 1 спам запрещён, уровню 2 разрешён', a === "⛔ Команда '*спам' недоступна для твоего уровня доступа" && n === 2, a); }

    // ---------- межплатформенные команды (ТЗ п. 5.6) ----------
    { const tgCalls = [];
      const bot = { botInfo: { id: 1 }, settings: { prefix: '‘' }, commands: { 'о_чате': () => {} },
        telegramClient: { sendMessage: async (chat, o) => { tgCalls.push(['send', chat, o.message]); return { id: 321 }; } },
        handleCommand: async (...a) => tgCalls.push(['handle', a[0], a[1].join(' '), a[3], a[5]]) };
      const t = setup({ bot }); await t.run('*тг_о_чате'); const a = t.last(); const c1 = JSON.stringify(tgCalls);
      tgCalls.length = 0; await t.run('*тг_-100500_о_чате x'); const b = t.last(); const c2 = JSON.stringify(tgCalls);
      await t.run('*тг_нетакой'); const c3 = t.last();
      const t2 = setup(); await t2.run('*тг_о_чате');
      check(null, 'VK → TG: *тг_X и *тг_[chatId]_X идут в handleCommand TG; нет команды или TG не авторизован — ошибка',
        a === '✅ Выполнено в TG: ‘о_чате → чат 1' && c1 === JSON.stringify([['send', 1, '⏳ ‘о_чате (из VK)'], ['handle', 'о_чате', '', 1, 321]])
        && b === '✅ Выполнено в TG: ‘о_чате → чат -100500' && c2.includes('"handle","о_чате","x",-100500,321') && c3 === "❌ TG команда '‘нетакой' не найдена" && t2.last() === '❌ TG не авторизован, команда не выполнена', JSON.stringify([a, c1, b, c2, c3])); }
    { const t = setup(); const own = { fromOwner: true };
      const r1 = await t.c.runFromTg('пинг', [], own); const sentToSelf = t.calls.every((x) => x.method !== 'messages.edit');
      const r2 = await t.c.runFromTg('555_айди', ['@durov'], own); const r3 = await t.c.runFromTg('лп_статус', [], own); const r4 = await t.c.runFromTg('нетакой', [], own);
      t.c.running = false; const r5 = await t.c.runFromTg('пинг', [], own);
      check(null, 'TG → VK (runFromTg): вк_X и вк_[peer]_X, ответ текстом для TG, без правки в VK',
        r1.startsWith('✅ VK (peer 42): 🏓 ...\n🏓 Понг!') && sentToSelf && r2 === '✅ VK (peer 555): 👤 Павел Дуров • vk.com/durov\n🆔 555' && r3.startsWith('✅ VK (peer 42): 📡 VK LP') && r4 === "❌ VK команда '*нетакой' не найдена" && r5 === '❌ VK-клиент не запущен',
        JSON.stringify([r1, r2, r4, r5])); }
    { // handleCommand TG из script.js: вк_… уходит в vkClient.runFromTg, остальное — как раньше
      const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
      const cut = src.indexOf('// ========== ЗАПУСК БОТА ==========');
      const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, construct: () => stub });
      const req = (n) => (['fs', 'path', 'crypto'].includes(n) ? require(n) : stub);
      const lpbot = new Function('require', 'module', '__dirname', 'process', src.slice(0, cut) + '\nreturn lpbot;')(req, {}, path.join(__dirname, '..'), process);
      const b = Object.create(lpbot.prototype);
      const edits = [];
      Object.assign(b, { botInfo: { id: 1 }, commands: { 'пинг': async () => edits.push('tg-пинг') }, settings: { prefix: '‘' }, getUserData: async () => ({}), editMessage: async (c, m, t) => edits.push([c, m, t]),
        vkClient: { runFromTg: async (rest, args, o) => `VK:${rest}:${args.join(',')}:${o && o.fromOwner}` } });
      await b.handleCommand('вк_555_айди', ['@durov'], {}, 10, 1, 77);
      await b.handleCommand('пинг', [], {}, 10, 1, 78);
      await b.handleCommand('вкк', [], {}, 10, 1, 79);
      check(null, 'script.js handleCommand: ‘вк_… → vkClient.runFromTg и правка TG-сообщения; обычные и неизвестные команды как раньше',
        JSON.stringify(edits) === JSON.stringify([[10, 77, 'VK:555_айди:@durov:true'], 'tg-пинг', [10, 79, '❌ Неизвестная команда: ‘вкк']]), JSON.stringify(edits)); }

    // ---------- права (ревью Романа, требование Дениса) ----------
    // script.js handleCommand на настоящем VkClient: мост TG → VK только от владельца
    const loadLpbot = () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
        const cut = src.indexOf('// ========== ЗАПУСК БОТА ==========');
        const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, construct: () => stub });
        const req = (n) => (['fs', 'path', 'crypto'].includes(n) ? require(n) : stub);
        return new Function('require', 'module', '__dirname', 'process', src.slice(0, cut) + '\nreturn lpbot;')(req, {}, path.join(__dirname, '..'), process);
    };
    const lpbot = loadLpbot();
    const tgBridge = (t) => {
        const b = Object.create(lpbot.prototype); const edits = []; const bridged = [];
        const real = t.c.runFromTg.bind(t.c);
        t.c.runFromTg = async (...a) => { bridged.push(a[0]); return real(...a); };
        Object.assign(b, { botInfo: { id: 1 }, commands: {}, settings: { prefix: '‘' }, getUserData: async () => ({}),
            editMessage: async (c, m, x) => edits.push(x), vkClient: t.c });
        return { b, edits, bridged };
    };
    { const t = setup(); const { b, edits, bridged } = tgBridge(t);
      t.calls.length = 0;
      await b.handleCommand('вк_вк_токен', ['vk1.a.STRANGER_TOKEN_xxxxxxxxxxxxxxxxxxxx'], { out: false }, 10, 999, 80);
      await b.handleCommand('вк_спам', ['50', 'х'], { out: false }, 10, 999, 81);
      const strangerOk = bridged.length === 0 && edits.length === 0 && t.calls.length === 0 && t.c.state.userToken !== 'vk1.a.STRANGER_TOKEN_xxxxxxxxxxxxxxxxxxxx';
      await b.handleCommand('вк_ор_статус', [], { out: true }, 10, 1, 82);
      const ownerOk = bridged.join() === 'ор_статус' && /^✅ VK \(peer 42\): 🤖 OpenRouter/.test(edits[0] || '');
      const direct = await t.c.runFromTg('вк_токен', ['x']);
      check(null, 'права TG → VK: *вк_вк_токен / *вк_спам от постороннего не доходят до runFromTg и VK; от владельца выполняются; runFromTg без флага владельца — отказ',
        strangerOk && ownerOk && direct === '⛔ Команды VK из TG доступны только владельцу', JSON.stringify({ strangerOk, bridged, edits, direct })); }
    // VK → TG: *тг_ только владельцу
    { const tgCalls = [];
      const bot = { botInfo: { id: 1 }, settings: { prefix: '‘' }, commands: { 'о_чате': () => {} },
        telegramClient: { sendMessage: async (chat, o) => { tgCalls.push('send'); return { id: 321 }; } },
        handleCommand: async () => tgCalls.push('handle') };
      const t = setup({ bot, trusted: { 777: 1 } }); const res = [];
      for (const lvl of [1, 2, 3]) { t.c.state.trusted[777] = lvl; await t.run('*тг_о_чате', { out: false, fromId: 777 }); res.push(t.last()); await t.run('*тг_-100500_о_чате', { out: false, fromId: 777 }); res.push(t.last()); }
      const denied = tgCalls.length === 0 && res.every((x) => x === '⛔ Команды TG (*тг_…) доступны только владельцу');
      await t.run('*тг_о_чате'); const own = t.last();
      check(null, 'права VK → TG: доверенный 1–3 уровня получает отказ на *тг_X и *тг_[chatId]_X, в TG ничего не уходит; владелец проходит',
        denied && own === '✅ Выполнено в TG: ‘о_чате → чат 1' && tgCalls.join() === 'send,handle', JSON.stringify({ res, tgCalls, own })); }
    // ВЛАДЕЛЕЦ и AI: посторонний и доверенный 1–2 уровня — ни напрямую, ни через мосты
    { const names = [...new VkClient({}, {}).commands.entries()].filter(([, c]) => ['ВЛАДЕЛЕЦ', 'AI / OPENROUTER'].includes(c.section)).map(([n]) => n);
      const bad = [];
      for (const n of names) {
        const args = n === 'код' ? ' показать script.js' : n === 'ор' ? ' привет' : n === 'вк_токен' ? ' vk1.a.EVIL_xxxxxxxxxxxxxxxxxxxxxxxxxxxx' : n === 'ор_ключ' ? ' sk-or-EVIL' : '';
        // посторонний напрямую: ни одного запроса и ответа
        { const t = setup(); t.c.state.openrouter.key = 'sk-or-REAL'; const c = await t.run(`*${n}${args}`, { out: false, fromId: 999 });
          if (c.length) bad.push(`посторонний ${n}: ${c.map((x) => x.method)}`); }
        // доверенный 1 и 2 напрямую: только отказ, команда не выполнена
        for (const lvl of [1, 2]) {
          const t = setup({ trusted: { 777: lvl } }); t.c.state.openrouter.key = 'sk-or-REAL'; const before = JSON.stringify(t.c.state);
          const c = await t.run(`*${n}${args}`, { out: false, fromId: 777 });
          const ok = c.length === 1 && c[0].params.message === `⛔ Команда '*${n}' недоступна для твоего уровня доступа` && JSON.stringify(t.c.state) === before;
          if (!ok) bad.push(`уровень ${lvl} ${n}: ${JSON.stringify(c.map((x) => x.params && x.params.message || x.method))}`);
          // доверенный через мост VK → TG (*тг_вк_X): отказ
          const c2 = await t.run(`*тг_вк_${n}${args}`, { out: false, fromId: 777 });
          if (!(c2.length === 1 && c2[0].params.message === '⛔ Команды TG (*тг_…) доступны только владельцу')) bad.push(`уровень ${lvl} *тг_вк_${n}`);
        }
        // посторонний через мост TG → VK: runFromTg не вызывается, в VK ничего
        { const t = setup(); const { b, edits, bridged } = tgBridge(t); t.calls.length = 0;
          await b.handleCommand(`вк_${n}`, args.trim() ? args.trim().split(' ') : [], { out: false }, 10, 999, 90);
          if (bridged.length || edits.length || t.calls.length) bad.push(`TG посторонний вк_${n}`); }
      }
      check(null, `права ВЛАДЕЛЕЦ и AI (${names.length} команд): посторонний и доверенный 1–2 уровня не выполняют ни одну ни напрямую, ни через *тг_ / ‘вк_`, bad.length === 0 && names.length === 13, bad.join(' | ')); }
    // ор — уровень 3 (ДОПУЩЕНИЕ), debug_triggers — не длиннее лимита VK
    { const t = setup({ trusted: { 777: 3 }, responses: { openrouter: { choices: [{ message: { content: 'ответ' } }] } } }); t.c.state.openrouter.key = 'sk-or-REAL';
      await t.run('*ор привет', { out: false, fromId: 777 }); const sent = t.calls.some((x) => x.method === 'openrouter');
      t.c.state.trusted[777] = 2; await t.run('*ор привет', { out: false, fromId: 777 }); const deny2 = t.last() === "⛔ Команда '*ор' недоступна для твоего уровня доступа" && !t.calls.some((x) => x.method === 'openrouter');
      check('ор', 'ор: доверенному 3-го уровня доступен, 2-го — отказ без запроса в OpenRouter', sent && deny2, JSON.stringify({ sent, deny2 })); }
    { const t = setup(); for (let i = 1; i <= 300; i++) t.c.state.triggers.push({ id: i, word: `слово${i}`, response: 'длинный ответ на триггер '.repeat(3) });
      await t.run('*debug_triggers'); const a = t.last();
      check('debug_triggers', 'debug_triggers: 300 триггеров — ответ обрезан до лимита VK (≤ 4096) с пометкой', a.length <= 4096 && a.includes('обрезано') && a.endsWith(`nextTriggerId: ${t.c.state.nextTriggerId}`), `длина ${a.length}`); }

    // ---------- покрытие ----------
    const untested = [...new VkClient({}, {}).commands.keys()].filter((k) => !tested.has(k));
    check(null, `покрытие: все ${new VkClient({}, {}).commands.size} команд VK покрыты тестами`, untested.length === 0, `без теста: ${untested.join(', ')}`);

    const fail = results.filter((x) => !x).length;
    console.log(fail ? `ИТОГ: ${fail} провал(ов) из ${results.length}` : `ИТОГ: все тесты пройдены (${results.length})`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); process.exit(1); });
