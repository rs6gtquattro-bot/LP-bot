// VK-клиент LP Bot (юзербот на пользовательском токене VK).
// Восстановлен по ТЗ docs/vk_client_spec.md. Оригинальный vk_client.js не сохранился,
// поэтому всё, что в ТЗ помечено ДОПУЩЕНИЕМ, здесь тоже допущение.
//
// Критерии приёмки (ТЗ, п. 9):
//  1. require без токена не падает и не ходит в сеть (сеть трогает только start()).
//  2. Без токена start() пишет одну строку в лог и выходит; TG работает независимо.
//  3. Все запросы (API и long poll) идут через прокси из конфига (vk.proxy).
//  4. Капча (error_code 14) — бэкофф с ростом паузы, без перезапуска процесса.
//  5. Префикс (по умолчанию '*') проверяется; неизвестная команда — ответ из ТЗ п. 5.3.

const DEFAULTS = {
    apiVersion: '5.199',               // ДОПУЩЕНИЕ (ТЗ п. 7)
    prefix: '*',                       // ТЗ п. 5.1
    proxy: 'socks5h://127.0.0.1:9050', // ТЗ п. 2.1: tor; пустая строка выключает прокси
    maxRequestsPerSecond: 3,           // ДОПУЩЕНИЕ (ТЗ п. 2.2)
    captchaBaseDelayMs: 60000,         // ДОПУЩЕНИЕ (ТЗ п. 2.2): от 60 секунд
    captchaMaxDelayMs: 15 * 60000,     // ДОПУЩЕНИЕ: потолок паузы
    captchaMaxRetries: 3,              // ДОПУЩЕНИЕ: после стольких капч подряд запрос отдаёт ошибку
    pollErrorBaseDelayMs: 5000,        // ДОПУЩЕНИЕ: пауза после сетевой ошибки long poll
    pollErrorMaxDelayMs: 5 * 60000,
    trustedIds: [],                    // ТЗ п. 5.4: доверенные VK-пользователи (кроме владельца)
};

class VkApiError extends Error {
    constructor(error) {
        super(`VK API ${error.error_code}: ${error.error_msg}`);
        this.code = error.error_code;
        this.vkError = error;
    }
}

class VkClient {
    // deps — для тестов: axios, createProxyAgent, now, sleep, log
    constructor(bot, config = {}, deps = {}) {
        this.bot = bot;
        this.config = { ...DEFAULTS, ...config };
        this.deps = {
            axios: deps.axios || null,
            createProxyAgent: deps.createProxyAgent || null,
            now: deps.now || (() => Date.now()),
            sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
            log: deps.log || ((...a) => console.log(...a)),
        };
        this.token = process.env.VK_USER_TOKEN || this.config.userToken || ''; // ТЗ п. 3.2
        this.commands = new Map(); // имя команды → async (ctx) => {}
        this.running = false;
        this.requestTimes = [];
        this.captchaStreak = 0;
        this.pollErrorStreak = 0;
        this.http = null;
        this.status = { connected: false, ts: null, lastEventAt: null, errors: 0, captchas: 0 }; // для *вк_лп_статус
    }

    // ---------- запуск ----------
    async start() {
        if (!this.token) {
            this.deps.log('⚠️ VK: токен не задан (VK_USER_TOKEN или vk.userToken в config.json), VK-клиент не запущен');
            return false;
        }
        this.http = this.createHttp();
        const [me] = await this.api('users.get', {});
        this.ownerId = me && me.id;
        this.running = true;
        this.deps.log(`✅ VK: клиент запущен${this.ownerId ? ` (id ${this.ownerId})` : ''}`);
        this.pollPromise = this.pollLoop();
        return true;
    }

    stop() {
        this.running = false;
        this.status.connected = false;
    }

    // ---------- транспорт ----------
    createHttp() {
        const axios = this.deps.axios || require('axios');
        const opts = { timeout: 35000, proxy: false };
        if (this.config.proxy) {
            const agent = this.deps.createProxyAgent
                ? this.deps.createProxyAgent(this.config.proxy)
                : new (require('socks-proxy-agent').SocksProxyAgent)(this.config.proxy);
            opts.httpAgent = agent;
            opts.httpsAgent = agent;
        }
        return axios.create(opts);
    }

    // Лимит: не больше maxRequestsPerSecond запросов к API за любое окно в 1 секунду.
    async rateLimit() {
        const limit = this.config.maxRequestsPerSecond;
        for (;;) {
            const now = this.deps.now();
            this.requestTimes = this.requestTimes.filter((t) => now - t < 1000);
            if (this.requestTimes.length < limit) {
                this.requestTimes.push(now);
                return;
            }
            await this.deps.sleep(1000 - (now - this.requestTimes[0]));
        }
    }

    captchaDelay(streak) {
        return Math.min(this.config.captchaBaseDelayMs * 2 ** (streak - 1), this.config.captchaMaxDelayMs);
    }

    async api(method, params = {}) {
        for (;;) {
            await this.rateLimit();
            const { data } = await this.http.post(
                `https://api.vk.com/method/${method}`,
                new URLSearchParams({ ...params, access_token: this.token, v: this.config.apiVersion }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            if (data && data.error) {
                if (data.error.error_code === 14) {
                    this.captchaStreak++;
                    this.status.captchas++;
                    if (this.captchaStreak > this.config.captchaMaxRetries) {
                        this.captchaStreak = 0;
                        throw new VkApiError(data.error);
                    }
                    const delay = this.captchaDelay(this.captchaStreak);
                    this.deps.log(`⏳ VK: капча на ${method}, пауза ${Math.round(delay / 1000)} с (${this.captchaStreak}/${this.config.captchaMaxRetries})`);
                    await this.deps.sleep(delay);
                    continue;
                }
                throw new VkApiError(data.error);
            }
            this.captchaStreak = 0;
            return data.response;
        }
    }

    // ---------- long poll (ДОПУЩЕНИЕ, ТЗ п. 4.2) ----------
    async getServer() {
        const s = await this.api('messages.getLongPollServer', { lp_version: 3, need_pts: 1 });
        this.lp = { server: s.server, key: s.key, ts: s.ts };
        this.status.ts = s.ts;
        this.status.connected = true;
    }

    async pollLoop() {
        while (this.running) {
            try {
                if (!this.lp) await this.getServer();
                const url = `https://${this.lp.server}?act=a_check&key=${this.lp.key}&ts=${this.lp.ts}&wait=25&mode=2&version=3`;
                const { data } = await this.http.get(url);
                if (data.failed === 1) { this.lp.ts = data.ts; continue; }
                if (data.failed) { this.lp = null; continue; }
                this.lp.ts = data.ts;
                this.status.ts = data.ts;
                this.pollErrorStreak = 0;
                for (const u of data.updates || []) {
                    const msg = this.normalize(u);
                    if (msg) {
                        this.status.lastEventAt = this.deps.now();
                        await this.handleMessage(msg).catch((e) => { this.status.errors++; this.deps.log('❌ VK: ошибка обработки:', e.message); });
                    }
                }
            } catch (e) {
                // Защита от цикла перезапусков (ТЗ п. 2.2): процесс не падает, пауза растёт.
                this.status.errors++;
                this.status.connected = false;
                this.lp = null;
                this.pollErrorStreak++;
                const delay = Math.min(this.config.pollErrorBaseDelayMs * 2 ** (this.pollErrorStreak - 1), this.config.pollErrorMaxDelayMs);
                this.deps.log(`⚠️ VK LP: ${e.message}, повтор через ${Math.round(delay / 1000)} с`);
                await this.deps.sleep(delay);
            }
        }
    }

    // Событие 4 (новое сообщение) → объект как у TG (ТЗ п. 4.2).
    normalize(u) {
        if (!Array.isArray(u) || u[0] !== 4) return null;
        const [, messageId, flags, peerId, , text, extra = {}] = u;
        const out = (flags & 2) === 2;
        const fromId = out ? this.ownerId : (peerId > 2000000000 ? Number(extra.from) : peerId);
        return { platform: 'vk', messageId, peerId, fromId, out, text: String(text || '') };
    }

    // ---------- команды (ТЗ п. 5) ----------
    registerCommand(name, handler) {
        this.commands.set(name.toLowerCase(), handler);
    }

    isAllowed(msg) {
        return msg.out || msg.fromId === this.ownerId || this.config.trustedIds.map(Number).includes(Number(msg.fromId));
    }

    async handleMessage(msg) {
        const prefix = this.config.prefix;
        if (!msg.text.startsWith(prefix)) return false;         // ТЗ п. 5.2: без префикса не реагируем
        if (!this.isAllowed(msg)) return false;                 // ТЗ п. 5.4
        const body = msg.text.slice(prefix.length).trim();
        if (!body) return false;
        const [name, ...args] = body.split(/\s+/);
        const handler = this.commands.get(name.toLowerCase());
        if (!handler) {
            await this.send(msg.peerId, `❌ Команда '${prefix}${name}' не найдена\nДля TG команд: ${prefix}тг_${name}`); // ТЗ п. 5.3
            return true;
        }
        await handler({ client: this, msg, args, name });
        return true;
    }

    async send(peerId, text, opts = {}) {
        return this.api('messages.send', { peer_id: peerId, message: text, random_id: Math.floor(Math.random() * 2 ** 31), ...opts });
    }
}

module.exports = VkClient;
module.exports.VkClient = VkClient;
module.exports.VkApiError = VkApiError;
