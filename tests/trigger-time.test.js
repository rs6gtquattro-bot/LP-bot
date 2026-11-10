require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// Тест проверки времени/дней триггеров и неизменности parseTime.
// Запуск: node tests/trigger-time.test.js  (сеть и Telegram не нужны)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const cut = src.indexOf('// ========== ЗАПУСК БОТА ==========');
assert(cut > 0, 'не найден маркер запуска бота');

// Заглушка для всех внешних модулей: класс lpbot только объявляется, ничего не запускается.
const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, construct: () => stub });
const fakeRequire = (name) => (['fs', 'path', 'crypto'].includes(name) ? require(name) : stub);
const lpbot = new Function('require', 'module', '__dirname', 'process', src.slice(0, cut) + '\nreturn lpbot;')(fakeRequire, {}, path.join(__dirname, '..'), process);

const bot = Object.create(lpbot.prototype);
const RealDate = Date;
function at(iso, fn) { // подменяем "сейчас"
    global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [iso])); } };
    try { return fn(); } finally { global.Date = RealDate; }
}
const trig = (s) => ({ settings: Object.assign({ allowedChats: [], excludedChats: [], allowedUsers: [], excludedUsers: [], timeStart: null, timeEnd: null, days: [] }, s) });
const check = (t, iso) => at(iso, () => bot.checkTriggerConditions(t, 1, 2));

const work = trig({ timeStart: '09:00', timeEnd: '18:00', days: [1, 2, 3, 4, 5] });
const cases = [
    ['окно 09-18 пн-пт, пн 10:30', work, '2026-11-09T10:30:00', true],
    ['окно 09-18 пн-пт, пт 17:59', work, '2026-11-13T17:59:00', true],
    ['окно 09-18 пн-пт, пн 08:59', work, '2026-11-09T08:59:00', false],
    ['окно 09-18 пн-пт, пн 18:01', work, '2026-11-09T18:01:00', false],
    ['окно 09-18 пн-пт, сб 12:00', work, '2026-11-14T12:00:00', false],
    ['окно 09-18 пн-пт, вс 12:00', work, '2026-11-15T12:00:00', false],
    ['без флагов, сб 03:00', trig({}), '2026-11-14T03:00:00', true],
    ['без флагов, пн 12:00', trig({}), '2026-11-09T12:00:00', true],
    ['через полночь 22-06, 23:30', trig({ timeStart: '22:00', timeEnd: '06:00' }), '2026-11-09T23:30:00', true],
    ['через полночь 22-06, 12:00', trig({ timeStart: '22:00', timeEnd: '06:00' }), '2026-11-09T12:00:00', false],
    ['дни из БД строками ["6","7"], сб', trig({ days: ['6', '7'] }), '2026-11-14T12:00:00', true],
];
let fail = 0;
for (const [name, t, iso, exp] of cases) {
    const got = check(t, iso);
    const ok = got === exp; if (!ok) fail++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ожидалось ${exp}, получено ${got}`);
}
const pc = [['09:00', 540], ['18:00', 1080], ['0:05', 5], ['24:00', null], ['9ч', null], [null, null]];
for (const [inp, exp] of pc) { const got = bot.parseClock(inp); const ok = got === exp; if (!ok) fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} parseClock(${JSON.stringify(inp)}) = ${got}`); }
const pt = bot.parseTime('5м'); if (pt !== 300) fail++; console.log(`${pt === 300 ? 'OK  ' : 'FAIL'} parseTime('5м') = ${pt} (таймеры не сломаны)`);
console.log(fail ? `ИТОГ: ${fail} провал(ов)` : 'ИТОГ: все тесты пройдены');
process.exit(fail ? 1 : 0);
