require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// Этап 0 модульности: слепок имён команд TG и VK из кода 28534b3.
// Ловит любую потерю, лишнее имя или дубль после каждого этапа.
// TG: script.js НЕ запускается, имена и обработчики берутся разбором текста setupCommands.
// VK: настоящий VkClient без токена и без сети, registerDefaultCommands.
// Запуск: env -u VK_USER_TOKEN unshare -rn node tests/registry.test.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// В плане модульности стояло 41 имя TG; в коде 28534b3 фактически 40. Слепок — по коду.
const TG = ['уведы', 'автопуши', 'qr', 'чек_qr', 'проверить', 'прокси', 'о_чате', 'кража_авы', 'перевод', 'айди',
    'рег', 'прочитать', 'триггер', 'триггеры', 'debug_triggers', 'мегапуш', 'смс', 'бомба_смс', 'закреп', 'префикс',
    'поиск', 'команды', 'шаб', 'шаблон', 'шаблоны', 'премиум', 'тест', 'кастом', 'custom', 'по_приколу',
    'код', 'code', 'таймер', 'таймеры', 'сброс_прикола', 'дип', 'deepseek', 'дип_ключ', 'дип_статус', 'дип_помощь'];
// Имена TG, которых нет в тексте «команды» (showCommands) в 28534b3. Это факт кода, а не цель.
const TG_NOT_IN_HELP = ['debug_triggers', 'премиум', 'кастом', 'custom', 'по_приколу', 'код', 'code', 'таймер', 'таймеры',
    'сброс_прикола', 'deepseek', 'команды', 'шаблон', 'триггеры'];
// VK: 40 через reg() + 7 из цикла PROTECTION = 47.
const VK = ['пинг', 'кмд', 'хелп', 'триггер', 'триггеры', 'дельтриггер', 'шаблон', 'шаблоны', 'ш', 'доступ',
    'смс', 'фейк', 'спам', 'антимат', 'антиlink', 'антискрин', 'антифлуд', 'антибот', 'капча', 'антиспам',
    'закреп', 'прочитать', 'автоудалить', 'о_чате', 'айди', 'инвайт', 'упомянуть', 'онлайн', 'невидимка', 'геолокация',
    'вк_доступ', 'лп', 'лп_статус', 'лп_поиск', 'адм', 'вк_токен', 'вк_группа', 'вк_настройки', 'вк_лп_статус', 'сессии',
    'код', 'debug_triggers', 'ор', 'ор_ключ', 'ор_статус', 'ор_модель', 'ор_помощь'];
const VK_PROTECTION = ['антимат', 'антиlink', 'антискрин', 'антифлуд', 'антибот', 'капча', 'антиспам'];

const res = [];
const check = (name, ok, detail = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`); };
const diff = (a, b) => ({ lost: b.filter((x) => !a.includes(x)), extra: a.filter((x) => !b.includes(x)) });
const dups = (a) => a.filter((x, i) => a.indexOf(x) !== i);

(async () => {
    // ---------- TG ----------
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const m = src.match(/setupCommands\(\)\s*\{\s*this\.commands\s*=\s*\{([\s\S]*?)\};/);
    check('1. TG: блок setupCommands найден в script.js', !!m);
    const pairs = m ? [...m[1].matchAll(/'([^']+)'\s*:\s*this\.([A-Za-z0-9_]+)\.bind\(this\)/g)].map((x) => [x[1], x[2]]) : [];
    const entries = m ? (m[1].match(/'[^']+'\s*:/g) || []).length : 0;
    const tgNames = pairs.map((p) => p[0]);
    const d1 = diff(tgNames, TG);
    check(`2. TG: имена совпадают со слепком (${TG.length})`, d1.lost.length === 0 && d1.extra.length === 0 && entries === pairs.length,
        `потеряны: [${d1.lost}] лишние: [${d1.extra}] записей ${entries}, разобрано ${pairs.length}`);
    check('3. TG: дублей имён нет', dups(tgNames).length === 0, `дубли: [${dups(tgNames)}]`);
    const noHandler = pairs.filter(([, fn]) => !new RegExp(`\\n\\s*(async\\s+)?${fn}\\s*\\(`).test(src)).map(([n, fn]) => `${n}→${fn}`);
    check('4. TG: у каждой команды есть метод-обработчик в классе', noHandler.length === 0, `без обработчика: [${noHandler}]`);
    const sc = src.slice(src.indexOf('async showCommands('));
    const cat = sc.slice(0, sc.indexOf('let response'));
    const helpNames = [...new Set([...cat.matchAll(/command:\s*'([^\s']+)/g)].map((x) => x[1]))];
    const phantom = helpNames.filter((x) => !TG.includes(x));
    check('5. TG: в тексте «команды» нет несуществующих имён', helpNames.length > 0 && phantom.length === 0, `фантомы: [${phantom}]`);
    const missing = TG.filter((x) => !helpNames.includes(x));
    const d2 = diff(missing, TG_NOT_IN_HELP);
    check(`6. TG: имена вне текста «команды» совпадают со слепком (${TG_NOT_IN_HELP.length}): ${TG_NOT_IN_HELP.join(' ')}`,
        d2.lost.length === 0 && d2.extra.length === 0, `сейчас вне справки: [${missing}]`);
    check('7. TG: «команды» считает всего команд по this.commands', /Всего команд: \$\{Object\.keys\(this\.commands\)\.length\}/.test(sc));

    // ---------- VK ----------
    const VkClient = require(path.join(ROOT, 'vk_client.js'));
    const c = new VkClient({}, { proxy: '' }, { log: () => {} });
    const vkNames = [...c.commands.keys()];
    const d3 = diff(vkNames, VK);
    check(`8. VK: имена совпадают со слепком (${VK.length} = 40 + ${VK_PROTECTION.length} защиты)`, d3.lost.length === 0 && d3.extra.length === 0,
        `потеряны: [${d3.lost}] лишние: [${d3.extra}]`);
    const badH = vkNames.filter((n) => typeof c.commands.get(n).handler !== 'function');
    check('9. VK: у каждой команды есть обработчик-функция', badH.length === 0, `без обработчика: [${badH}]`);
    const out = [];
    await c.commands.get('кмд').handler({ args: ['все'], rest: 'все', reply: async (t) => { out.push(t); return 1; }, edit: async () => {} }, 'все');
    const all = out.join('\n'); const p = c.config.prefix;
    const notInHelp = vkNames.filter((n) => !all.includes(`${p}${n}`));
    check(`10. VK: «кмд все» перечисляет все ${VK.length} команд`, notInHelp.length === 0 && all.includes(`${VK.length} команд`), `нет в справке: [${notInHelp}]`);

    // ---------- сводка ----------
    const common = TG.filter((x) => VK.includes(x));
    console.log(`ЧИСЛО: TG ${tgNames.length} (план 41, расхождение -1), VK ${vkNames.length} (40 + 7 защиты), общих имён ${common.length}`);
    const fail = res.filter((x) => !x).length;
    console.log(fail ? `ИТОГ: провалов ${fail} из ${res.length}` : `ИТОГ: все тесты пройдены (${res.length})`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`FAIL исключение: ${e.message}`); console.log('ИТОГ: провалов 1'); process.exit(1); });
