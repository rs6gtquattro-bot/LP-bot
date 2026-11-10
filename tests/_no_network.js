// Защита: тесты на заглушках обязаны идти без сети.
// На Linux: под unshare -rn (сетевых интерфейсов кроме петли нет).
// На Windows: Socket & DNS Guardian блокирует все сетевые сокеты и DNS на уровне рантайма Node.js.
const os = require('os');
const net = require('net');
const dns = require('dns');

let guardianInstalled = false;

function installSocketGuardian() {
    if (guardianInstalled) return;
    guardianInstalled = true;

    // 1. Блокировка попыток открытия сетевых сокетов (net, tls, http, https, ws)
    net.Socket.prototype.connect = function(...args) {
        const target = typeof args[0] === 'object'
            ? `${args[0].host || 'unknown'}:${args[0].port || ''}`
            : `${args[1] || 'unknown'}:${args[0] || ''}`;
        const err = new Error(`FATAL NETWORK VIOLATION: попытка открыть сокет к [${target}] в изолированном тесте!`);
        console.error(`\n❌ ${err.message}`);
        this.destroy(err);
        process.exit(1);
    };

    // 2. Блокировка DNS-резолва
    const blockDns = (fnName) => {
        if (typeof dns[fnName] === 'function') {
            dns[fnName] = function(...args) {
                const cb = args.find(a => typeof a === 'function');
                const err = new Error(`DNS resolution forbidden in isolated tests: ${args[0]}`);
                if (cb) setImmediate(() => cb(err));
                else return Promise.reject(err);
            };
        }
    };
    ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveSrv'].forEach(blockDns);

    // 3. Подмена os.networkInterfaces() на loopback
    os.networkInterfaces = function() {
        return {
            lo: [{
                address: '127.0.0.1',
                netmask: '255.0.0.0',
                family: 'IPv4',
                mac: '00:00:00:00:00:00',
                internal: true,
                cidr: '127.0.0.1/8'
            }]
        };
    };
}

module.exports = function noNetwork() {
    const ext = Object.entries(os.networkInterfaces())
        .filter(([, addrs]) => (addrs || []).some(a => !a.internal))
        .map(([name]) => name);
    if (!ext.length) return;

    if (process.platform === 'win32' || process.env.LP_NETWORK_GUARD === '1') {
        installSocketGuardian();
        return;
    }

    console.log(`FAIL сеть доступна (${ext.join(', ')}): запускай тест только под unshare -rn node <тест>`);
    console.log('ИТОГ: провалов 1');
    process.exit(1);
};

