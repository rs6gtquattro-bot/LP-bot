require('./_no_network.js')(); // без сети, иначе FAIL (см. tests/_no_network.js)
// VK через туннель: если прокси (туннель до ПК) недоступен, VK-клиент получает ошибку
// и НЕ идёт в VK напрямую. Реальный axios, агент-заглушка, прямые соединения считаются.
// Запуск: unshare -rn node tests/vk_proxy_failclosed.test.js
const net = require('net');
const tls = require('tls');
const path = require('path');
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail && !ok ? `\n     ${detail}` : ''}`); };

const direct = [];
for (const [mod, fn] of [[net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) {
    const orig = mod[fn];
    mod[fn] = function (...a) { direct.push(fn); return orig.apply(this, a); };
}
const { VkClient } = require(path.join(__dirname, '..', 'vk_client.js'));

(async () => {
    const created = [];
    // Такой же базовый класс, как у socks-proxy-agent; соединение до туннеля не устанавливается.
    const { Agent } = require(require.resolve('agent-base', { paths: [path.dirname(require.resolve('socks-proxy-agent'))] }));
    class DeadTunnelAgent extends Agent {
        async connect() { const e = new Error('tunnel down'); e.code = 'ECONNREFUSED'; throw e; }
    }
    const c = new VkClient({}, { userToken: 'TEST', proxy: 'socks5h://127.0.0.1:1080' }, {
        log: () => {}, createProxyAgent: (u) => { created.push(u); return new DeadTunnelAgent(); },
        now: () => 0, sleep: async () => {},
    });
    c.http = c.createHttp();
    let err = null;
    try { await c.api('users.get', {}); } catch (e) { err = e; }
    check('1. агент создан из vk.proxy = socks5h://127.0.0.1:1080', created.length === 1 && created[0] === 'socks5h://127.0.0.1:1080', JSON.stringify(created));
    check('2. туннель недоступен: api() отдаёт ошибку', !!err && /tunnel down|ECONNREFUSED/.test(String(err && (err.message || err.code))), String(err));
    check('3. прямых соединений (net/tls) нет, обхода туннеля нет', direct.length === 0, direct.join(','));
    const lpHttp = c.http.defaults;
    check('4. у axios выключен встроенный proxy и оба агента — туннель', lpHttp.proxy === false && lpHttp.httpsAgent instanceof DeadTunnelAgent && lpHttp.httpAgent instanceof DeadTunnelAgent);
    console.log(`ИТОГ: ${results.every(Boolean) ? 'все тесты пройдены' : `провалов ${results.filter((r) => !r).length}`}`);
    process.exit(results.every(Boolean) ? 0 : 1);
})();
