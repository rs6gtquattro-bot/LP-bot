// Тест безопасности веб-панели: аутентификация по токену, защита от CSRF и CSWSH
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const WebInterface = require(path.join(__dirname, '..', 'web_interface.js'));

let fail = 0, ok = 0;
const t = (cond, msg) => {
    if (cond) { ok++; console.log('OK  ', msg); }
    else { fail++; console.log('FAIL', msg); }
};

const makeRequest = (options, postData) => new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
});

const TEST_TOKEN = 'secret-test-token-1234567890abcdef1234567890abcdef';
const bot = {
    settings: { prefix: '*', triggers: new Map(), timers: new Map(), templates: new Map(), customValues: {}, deepseek: {} },
    commands: {},
    isRunning: true,
    startTime: new Date(),
    panelToken: TEST_TOKEN
};

(async () => {
    console.log('--- ТЕСТЫ БЕЗОПАСНОСТИ: АВТОРИЗАЦИЯ ПАНЕЛИ, CSRF И CSWSH ---');

    const wi = new WebInterface(bot, null, 0, '127.0.0.1', TEST_TOKEN);
    await wi.start();
    const port = wi.server.address().port;

    try {
        // 1. Запрос к API без токена -> 401
        const resNoAuth = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: '/api/settings',
            method: 'GET'
        });
        t(resNoAuth.statusCode === 401, 'Запрос без токена возвращает 401 Unauthorized');

        // 2. Запрос с неверным токеном -> 401
        const resBadAuth = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: '/api/settings',
            method: 'GET',
            headers: { 'Authorization': 'Bearer wrong-token' }
        });
        t(resBadAuth.statusCode === 401, 'Запрос с неверным токеном возвращает 401 Unauthorized');

        // 3. Запрос с правильным Bearer токеном -> 200
        const resBearer = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: '/api/settings',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${TEST_TOKEN}` }
        });
        t(resBearer.statusCode === 200, 'Запрос с валидным Bearer-токеном успешен (200 OK)');

        // 4. Запрос через query ?token= -> 200 и выставление cookie
        const resQuery = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: `/?token=${TEST_TOKEN}`,
            method: 'GET'
        });
        t(resQuery.statusCode === 200, 'Вход по ссылке ?token= успешен (200 OK)');
        const setCookie = resQuery.headers['set-cookie'];
        t(Array.isArray(setCookie) && setCookie.some(c => c.includes(`lp_auth_token=${TEST_TOKEN}`) && c.includes('HttpOnly') && c.includes('SameSite=Strict')),
            'При входе через ?token выставляется безопасная cookie lp_auth_token (HttpOnly, SameSite=Strict)');

        // 5. Запрос с cookie -> 200
        const resCookie = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: '/api/settings',
            method: 'GET',
            headers: { 'Cookie': `lp_auth_token=${TEST_TOKEN}` }
        });
        t(resCookie.statusCode === 200, 'Запрос с валидной cookie lp_auth_token успешен (200 OK)');

        // 6. CSRF атака: POST с чужим Origin -> 403
        const resCsrf = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: '/settings',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TEST_TOKEN}`,
                'Origin': 'http://malicious-site.com',
                'Host': `127.0.0.1:${port}`,
                'Content-Type': 'application/json'
            }
        }, { prefix: '!' });
        t(resCsrf.statusCode === 403, 'CSRF атака с чужим Origin (malicious-site.com) блокирована (403 Forbidden)');

        // 7. Легитимный POST с правильным Origin -> 200
        bot.saveSettings = () => {};
        const resValidPost = await makeRequest({
            hostname: '127.0.0.1',
            port,
            path: '/settings',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TEST_TOKEN}`,
                'Origin': `http://127.0.0.1:${port}`,
                'Host': `127.0.0.1:${port}`,
                'Content-Type': 'application/json'
            }
        }, { prefix: '*' });
        t(resValidPost.statusCode === 200, 'Легитимный POST запрос с доверенным Origin успешен (200 OK)');

        // 8. WebSocket CSWSH: подключение со стороннего Origin -> отказ
        const wsCsrfFailed = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`, {
                origin: 'http://evil-hacker.com'
            });
            ws.on('open', () => { ws.close(); resolve(false); });
            ws.on('error', () => { resolve(true); });
            ws.on('unexpected-response', (req, res) => { resolve(res.statusCode === 403); });
        });
        t(wsCsrfFailed, 'CSWSH: WebSocket-подключение с чужим Origin отклонено');

        // 9. WebSocket: подключение без токена -> отказ
        const wsNoAuthFailed = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
                origin: `http://127.0.0.1:${port}`
            });
            ws.on('open', () => { ws.close(); resolve(false); });
            ws.on('error', () => { resolve(true); });
            ws.on('unexpected-response', (req, res) => { resolve(res.statusCode === 401); });
        });
        t(wsNoAuthFailed, 'WebSocket: подключение без токена отклонено (401)');

        // 10. WebSocket: легитимное подключение с доверенным Origin и токеном -> успех
        const wsValidOk = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`, {
                origin: `http://127.0.0.1:${port}`
            });
            ws.on('open', () => { ws.close(); resolve(true); });
            ws.on('error', () => { resolve(false); });
        });
        t(wsValidOk, 'WebSocket: легитимное подключение с токеном и доверенным Origin успешно');

    } finally {
        wi.stop();
    }

    console.log(fail ? `ИТОГ: провалов ${fail} из ${ok + fail}` : `ИТОГ: все проверки безопасности панели пройдены (${ok})`);
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('FAIL Ошибка теста:', e);
    process.exit(1);
});
