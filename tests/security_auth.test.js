require('./_no_network.js')(); // строго без сети, unshare -rn
// Тест безопасности авторизации команд (защита от RCE, проверка isOwnerMessage и ампутация спама)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const cut = src.indexOf('// ========== ЗАПУСК БОТА ==========');
if (cut < 0) throw new Error('Маркер запуска бота не найден в script.js');

const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub, construct: () => stub });
const fakeRequire = (n) => {
    if (['fs', 'path', 'crypto'].includes(n)) return require(n);
    return stub;
};
const lpbot = new Function('require', 'module', '__dirname', 'process', src.slice(0, cut) + '\nreturn lpbot;')(fakeRequire, {}, ROOT, process);

let fail = 0, ok = 0;
const t = (cond, msg) => {
    if (cond) { ok++; console.log('OK  ', msg); }
    else { fail++; console.log('FAIL', msg); }
};

(async () => {
    console.log('--- ТЕСТЫ БЕЗОПАСНОСТИ: ИЗОЛЯЦИЯ ПРАВ И ЗАЩИТА ОТ RCE ---');

    const bot = Object.create(lpbot.prototype);
    bot.botInfo = { id: 12345 };
    bot.settings = { prefix: '*' };
    bot.commands = {};
    bot.setupCommands();

    // 1. Проверка ампутации вредоносных команд
    t(bot.commands['мегапуш'] === undefined, 'Команда *мегапуш ампутирована из commands');
    t(bot.commands['бомба_смс'] === undefined, 'Команда *бомба_смс ампутирована из commands');
    t(typeof bot.megaPush === 'undefined', 'Метод megaPush полностью удалён из класса');
    t(typeof bot.smsBomb === 'undefined', 'Метод smsBomb полностью удалён из класса');

    // 2. Проверка работы isOwnerMessage
    const ownerMsg = { out: true };
    const strangerMsg = { out: false };
    
    t(bot.isOwnerMessage(ownerMsg, 99999) === true, 'isOwnerMessage: исходящее сообщение (out: true) признано сообщением владельца');
    t(bot.isOwnerMessage(strangerMsg, 12345) === true, 'isOwnerMessage: входящее от собственного ID признано сообщением владельца');
    t(bot.isOwnerMessage(strangerMsg, 99999) === false, 'isOwnerMessage: сообщение от постороннего (out: false, senderId 99999) ОТКЛОНЕНО');

    // 3. Проверка защиты manageCode на уровне Level 3
    let rceBlocked = false;
    try {
        await bot.manageCode(['создать', 'pwn.js'], strangerMsg, 100, 99999, 1);
    } catch (e) {
        if (e.message.includes('Критическая ошибка безопасности') || e.message.includes('только владельцу')) {
            rceBlocked = true;
        }
    }
    t(rceBlocked, 'manageCode: прямая попытка не-владельца создать файл заблокирована ошибкой безопасности');

    // 4. Проверка защиты handleCommand на уровне Level 2
    let executed = false;
    bot.commands['тест_команда'] = async () => { executed = true; };
    bot.getUserData = async () => null;
    bot.ensureUserExists = async () => {};

    // Попытка постороннего
    await bot.handleCommand('тест_команда', [], strangerMsg, 100, 99999, 1);
    t(executed === false, 'handleCommand: посторонний пользователь не может выполнить команду');

    // Вызов владельца
    await bot.handleCommand('тест_команда', [], ownerMsg, 100, 12345, 1);
    t(executed === true, 'handleCommand: владелец аккаунта успешно выполняет команду');

    console.log(fail ? `ИТОГ: провалов ${fail} из ${ok + fail}` : `ИТОГ: все проверки безопасности пройдены (${ok})`);
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('FAIL Неожиданное исключение:', e);
    process.exit(1);
});
