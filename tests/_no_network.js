// Защита: тесты на заглушках обязаны идти без сети (Linux: unshare -rn).
// Если у машины есть сетевой интерфейс кроме петли — тест сразу падает, ничего не запуская.
// Осознанный обход (например, на Windows, где unshare нет): LP_TEST_ALLOW_NET=1, тогда печатается WARN.
// strict: обход запрещён (тесты, которые запускают настоящий script.js).
const os = require('os');
module.exports = function noNetwork({ strict = false } = {}) {
    const ext = Object.entries(os.networkInterfaces())
        .filter(([, addrs]) => (addrs || []).some(a => !a.internal))
        .map(([name]) => name);
    if (!ext.length) return;
    if (!strict && process.env.LP_TEST_ALLOW_NET === '1') {
        console.log(`WARN сеть доступна (${ext.join(', ')}), проверка отключена через LP_TEST_ALLOW_NET=1`);
        return;
    }
    console.log(`FAIL сеть доступна (${ext.join(', ')}): запускай тест без сети, например unshare -rn node <тест>`);
    console.log('ИТОГ: провалов 1');
    process.exit(1);
};
