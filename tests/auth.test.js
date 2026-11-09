// Тест авторизации Telegram: ветка с готовой сессией и ветка без неё.
// Запуск: node tests/auth.test.js  (сеть и Telegram не нужны, всё на заглушках)
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const cut = src.indexOf('// ========== ЗАПУСК БОТА ==========');
if (cut < 0) throw new Error('не найден маркер запуска бота');

const calls = [];
let sessionValid = true;
class FakeClient {
    constructor(session) { this.session = { save: () => 'NEW_SESSION' }; this.connected = false; }
    async connect() { calls.push('connect'); this.connected = true; }
    async getMe() { calls.push('getMe'); if (!sessionValid) throw new Error('AUTH_KEY_UNREGISTERED'); return { id: 1, username: 'tester' }; }
    async start(opts) {
        calls.push('start');
        for (const k of ['phoneNumber', 'password', 'phoneCode', 'onError']) if (typeof opts[k] !== 'function') throw new Error('start без ' + k);
        calls.push('phone=' + await opts.phoneNumber()); calls.push('code=' + await opts.phoneCode());
        sessionValid = true;
    }
}
const fakeInput = { text: async (q) => (q.includes('Код') ? '12345' : '+70000000000'), password: async () => '' };
const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, construct: () => stub });
const fakeRequire = (n) => {
    if (n === 'telegram') return { TelegramClient: FakeClient };
    if (n === 'telegram/sessions') return { StringSession: class { constructor(s) { this.s = s; } } };
    if (n === 'input') return fakeInput;
    if (['fs', 'path', 'crypto'].includes(n)) return require(n);
    return stub;
};
const lpbot = new Function('require', 'module', '__dirname', 'process', src.slice(0, cut) + '\nreturn lpbot;')(fakeRequire, {}, path.join(__dirname, '..'), process);

function makeBot(session) {
    const bot = Object.create(lpbot.prototype);
    Object.assign(bot, { telegramApiId: 1, telegramApiHash: 'x' });
    bot.loadSession = () => session;
    bot.saveSession = (s) => calls.push('saveSession=' + s);
    bot.completeInitialization = async () => calls.push('completeInitialization');
    return bot;
}
const realLog = console.log, realErr = console.error;
async function run(name, session, valid, expected) {
    calls.length = 0; sessionValid = valid;
    console.log = () => {}; console.error = (...a) => calls.push('ERROR:' + a.join(' '));
    const origTimeout = global.setTimeout; global.setTimeout = () => calls.push('retry'); // ретрай при ошибке не ждём
    try { await makeBot(session).initializeTelegram(); } finally { console.log = realLog; console.error = realErr; global.setTimeout = origTimeout; }
    const ok = JSON.stringify(calls) === JSON.stringify(expected);
    realLog(`${ok ? 'OK  ' : 'FAIL'} ${name}\n     вызовы: ${calls.join(' → ')}`);
    return ok;
}
(async () => {
    const r = [
        await run('сессия есть и валидна: вход без start', 'OLD', true,
            ['connect', 'getMe', 'completeInitialization']),
        await run('сессии нет: client.start → сохранение → инициализация', '', true,
            ['connect', 'start', 'phone=+70000000000', 'code=12345', 'saveSession=NEW_SESSION', 'getMe', 'completeInitialization']),
        await run('сессия протухла: сброс → client.start → новая сессия', 'OLD', false,
            ['connect', 'getMe', 'saveSession=', 'start', 'phone=+70000000000', 'code=12345', 'saveSession=NEW_SESSION', 'getMe', 'completeInitialization']),
    ];
    const fail = r.filter(x => !x).length;
    realLog(fail ? `ИТОГ: ${fail} провал(ов)` : 'ИТОГ: все тесты пройдены');
    process.exit(fail ? 1 : 0);
})();
