// Защита: тесты на заглушках обязаны идти без сети, только Linux под unshare -rn.
// Если у машины есть сетевой интерфейс кроме петли — тест сразу падает, ничего не запуская. Обхода нет.
const os = require('os');
module.exports = function noNetwork() {
    const ext = Object.entries(os.networkInterfaces())
        .filter(([, addrs]) => (addrs || []).some(a => !a.internal))
        .map(([name]) => name);
    if (!ext.length) return;
    console.log(`FAIL сеть доступна (${ext.join(', ')}): запускай тест только под unshare -rn node <тест>`);
    console.log('ИТОГ: провалов 1');
    process.exit(1);
};
