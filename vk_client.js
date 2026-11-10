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

const APOSTROPHE_PREFIXES = new Set(["'", '‘', '’', 'ʼ', '`']);

const HTML_ENTITIES = {
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};
const HTML_RE = /&(?:quot|amp|lt|gt|#39|apos|nbsp|#\d+|#x[0-9a-fA-F]+);|<br\s*\/?>/gi;

function unescapeHTML(str) {
    if (!str || typeof str !== 'string') return '';
    if (!str.includes('&') && !str.includes('<')) return str;
    return str.replace(HTML_RE, (match) => {
        const lower = match.toLowerCase();
        if (HTML_ENTITIES[lower]) return HTML_ENTITIES[lower];
        if (lower === '<br>' || lower === '<br/>' || lower === '<br />') return '\n';
        if (lower.startsWith('&#x')) {
            const code = parseInt(lower.slice(3, -1), 16);
            return !isNaN(code) && code > 0 ? String.fromCharCode(code) : match;
        }
        if (lower.startsWith('&#')) {
            const code = parseInt(lower.slice(2, -1), 10);
            return !isNaN(code) && code > 0 ? String.fromCharCode(code) : match;
        }
        return match;
    });
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
            setTimeout: deps.setTimeout || ((fn, ms) => setTimeout(fn, ms)),
            setInterval: deps.setInterval || ((fn, ms) => setInterval(fn, ms)),
            clearInterval: deps.clearInterval || ((h) => clearInterval(h)),
        };
        this.token = process.env.VK_USER_TOKEN || this.config.userToken || ''; // ТЗ п. 3.2 (ещё есть запись из *вк_токен, см. loadState)
        this.commands = new Map(); // имя команды → { handler, section, usage, level }
        this.startedAt = this.deps.now();
        // Состояние VK-части. Хранится в общей БД бота, таблица vk_state (ТЗ п. 8).
        this.state = {
            trusted: {},          // vkId → уровень 1–3 (ТЗ п. 5.4; уровни — ДОПУЩЕНИЕ)
            protection: {},       // антимат/антиlink/антискрин/антифлуд/антибот/капча/антиспам → true/false
            triggers: [],         // { id, word, response }
            nextTriggerId: 1,
            lpLogger: { whitelist: false, blocked: [] },
            group: null,          // { id, token } из *вк_группа
            userToken: '',        // из *вк_токен
            openrouter: { key: '', model: 'deepseek/deepseek-chat' }, // модель по умолчанию — ДОПУЩЕНИЕ
            online: false,
            invisible: false,
            captchaPassed: [],
        };
        for (const id of this.config.trustedIds) this.state.trusted[Number(id)] = 1;
        this.lpCache = [];        // LP LOGGER: последние сообщения, ДОПУЩЕНИЕ: до 1000 штук
        this.floodTrack = new Map();
        this.spamTrack = new Map();
        this.captchaPending = new Map();
        this.onlineTimer = null;
        this.aiRequests = 0;
        registerDefaultCommands(this);
        this.running = false;
        this.requestTimes = [];
        this.captchaStreak = 0;
        this.pollErrorStreak = 0;
        this.http = null;
        this.status = { connected: false, ts: null, lastEventAt: null, errors: 0, captchas: 0, events: 0 }; // для *вк_лп_статус
        this.queue = [];
        this.processingQueue = false;
        this.drainResolvers = [];
    }

    // ---------- запуск ----------
    async start() {
        await this.loadState();
        if (!this.token) this.token = this.state.userToken || '';
        if (!this.token) {
            this.deps.log('⚠️ VK: токен не задан (VK_USER_TOKEN или vk.userToken в config.json), VK-клиент не запущен');
            return false;
        }
        this.http = this.createHttp();
        const [me] = await this.api('users.get', {});
        this.ownerId = me && me.id;
        this.running = true;
        this.deps.log(`✅ VK: клиент запущен${this.ownerId ? ` (id ${this.ownerId})` : ''}`);
        if (this.state.online) this.setOnline(true).catch(() => {});
        this.pollPromise = this.pollLoop();
        return true;
    }

    stop() {
        this.running = false;
        this.status.connected = false;
        if (this.onlineTimer) { this.deps.clearInterval(this.onlineTimer); this.onlineTimer = null; }
    }

    enqueueMessage(msg) {
        if (this.queue.length >= 500) {
            if (!this.isAllowed(msg)) return;
        }
        this.queue.push(msg);
        this.processQueue();
    }

    async processQueue() {
        if (this.processingQueue) return;
        this.processingQueue = true;
        try {
            while (this.queue.length > 0) {
                const msg = this.queue.shift();
                try {
                    await this.handleMessage(msg);
                } catch (e) {
                    this.status.errors++;
                    this.deps.log('❌ VK: ошибка обработки:', e.message);
                }
            }
        } finally {
            this.processingQueue = false;
            if (this.queue.length === 0 && this.drainResolvers.length > 0) {
                const resolvers = this.drainResolvers;
                this.drainResolvers = [];
                for (const r of resolvers) r();
            }
        }
    }

    drainQueue() {
        if (this.queue.length === 0 && !this.processingQueue) return Promise.resolve();
        return new Promise((resolve) => {
            this.drainResolvers.push(resolve);
        });
    }

    // ---------- состояние в БД ----------
    dbRun(sql, params = []) {
        const db = this.bot && this.bot.db;
        if (!db || typeof db.run !== 'function') return Promise.resolve();
        return new Promise((resolve, reject) => db.run(sql, params, (e) => (e ? reject(e) : resolve())));
    }

    async loadState() {
        const db = this.bot && this.bot.db;
        if (!db || typeof db.get !== 'function') return;
        try {
            await this.dbRun('CREATE TABLE IF NOT EXISTS vk_state (key TEXT PRIMARY KEY, value TEXT)');
            const row = await new Promise((resolve, reject) => db.get('SELECT value FROM vk_state WHERE key = ?', ['state'], (e, r) => (e ? reject(e) : resolve(r))));
            if (row && row.value) Object.assign(this.state, JSON.parse(row.value));
        } catch (e) {
            this.deps.log('⚠️ VK: не удалось прочитать vk_state:', e.message);
        }
    }

    async saveState() {
        try {
            await this.dbRun('CREATE TABLE IF NOT EXISTS vk_state (key TEXT PRIMARY KEY, value TEXT)');
            await this.dbRun('INSERT OR REPLACE INTO vk_state (key, value) VALUES (?, ?)', ['state', JSON.stringify(this.state)]);
        } catch (e) {
            this.deps.log('⚠️ VK: не удалось сохранить vk_state:', e.message);
        }
    }

    async setOnline(on) {
        if (this.onlineTimer) { this.deps.clearInterval(this.onlineTimer); this.onlineTimer = null; }
        if (on) {
            await this.api('account.setOnline', { voip: 0 });
            // ДОПУЩЕНИЕ: VK держит онлайн ~5 минут, продлеваем раз в 4 минуты
            this.onlineTimer = this.deps.setInterval(() => this.api('account.setOnline', { voip: 0 }).catch(() => {}), 4 * 60000);
        }
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
                        this.status.events++;
                        // только счётчик, без текста и отправителя
                        if (this.status.events === 1 || this.status.events % 100 === 0) this.deps.log(`📥 VK LP: событий ${this.status.events}`);
                        this.enqueueMessage(msg);
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
        await this.drainQueue();
    }

    // Событие 4 (новое сообщение) → объект как у TG (ТЗ п. 4.2).
    normalize(u) {
        if (!Array.isArray(u) || u[0] !== 4) return null;
        const [, messageId, flags, peerId, , text, extra = {}] = u;
        const out = (flags & 2) === 2;
        const fromId = out ? this.ownerId : (peerId > 2000000000 ? Number(extra.from) : peerId);
        const cleanText = unescapeHTML(String(text || ''));
        const msg = { platform: 'vk', messageId, peerId, fromId, out, text: cleanText };
        if (extra.source_act) msg.action = extra.source_act; // служебное событие беседы, например chat_screenshot
        return msg;
    }

    // ---------- префикс ----------
    // Префикс VK-команд общий с TG: берётся из settings.prefix бота (settings.json).
    // ДОПУЩЕНИЕ: если settings.prefix пуст, остаётся vk.prefix из config.json, иначе «*» из DEFAULTS.
    static configFor(bot, config = {}) {
        const p = bot && bot.settings && bot.settings.prefix;
        return typeof p === 'string' && p ? { ...config, prefix: p } : { ...config };
    }

    // Вызывается при смене префикса в TG (команда префикс) и при перечитывании settings.json
    setPrefix(p) {
        if (typeof p === 'string' && p) this.config.prefix = p;
    }

    matchPrefix(text) {
        const configured = this.config.prefix;
        if (!configured || !text || typeof text !== 'string') return null;
        if (APOSTROPHE_PREFIXES.has(configured)) {
            const firstChar = text.charAt(0);
            if (APOSTROPHE_PREFIXES.has(firstChar)) {
                return { matched: true, length: 1, char: firstChar };
            }
        }
        if (text.startsWith(configured)) {
            return { matched: true, length: configured.length, char: configured };
        }
        return null;
    }

    // ---------- команды (ТЗ п. 5) ----------
    // opts: { section, usage, level } — level 1–3 для доверенных или 'owner' (только владелец)
    registerCommand(name, handler, opts = {}) {
        this.commands.set(name.toLowerCase(), { handler, section: opts.section || 'ДРУГОЕ', usage: opts.usage || name, level: opts.level || 1 });
    }

    isOwner(msg) {
        return Boolean(msg.out || (this.ownerId && msg.fromId === this.ownerId) || msg.fromTg);
    }

    accessLevel(msg) {
        if (this.isOwner(msg)) return 'owner';
        return this.state.trusted[Number(msg.fromId)] || 0;
    }

    isAllowed(msg) {
        return this.accessLevel(msg) !== 0;
    }

    canRun(level, need) {
        if (level === 'owner') return true;
        if (need === 'owner') return false;
        return level >= need;
    }

    async handleMessage(msg) {
        this.logToCache(msg);
        const match = this.matchPrefix(msg.text);
        if (!match) {                                           // ТЗ п. 5.2: без префикса команды не выполняем
            if (!msg.out) await this.handleIncoming(msg);       // защита, капча, триггеры
            return false;
        }
        const level = this.accessLevel(msg);
        if (!level) {                                           // ТЗ п. 5.4
            if (!msg.out) await this.handleIncoming(msg);
            return false;
        }
        const prefix = this.config.prefix;
        const body = msg.text.slice(match.length).trim();
        if (!body) return false;
        const [rawName, ...args] = body.split(/\s+/);
        const name = rawName.toLowerCase();
        const ctx = this.makeContext(msg, name, args, body.slice(rawName.length).trim(), level);

        // Межплатформенные команды *тг_[команда] и *тг_[chatId]_[команда] (ТЗ п. 5.6)
        if (name.startsWith('тг_') && name.length > 3) {
            // Мост в TG выполняет команду от имени аккаунта, поэтому только владельцу
            if (level !== 'owner') {
                await ctx.reply(`⛔ Команды TG (${prefix}тг_…) доступны только владельцу`);
                return true;
            }
            await this.routeToTg(ctx, name.slice(3));
            return true;
        }
        const cmd = this.commands.get(name);
        if (!cmd) {
            await ctx.reply(`❌ Команда '${prefix}${rawName}' не найдена\nДля TG команд: ${prefix}тг_${rawName}`); // ТЗ п. 5.3
            return true;
        }
        if (!this.canRun(level, cmd.level)) {
            await ctx.reply(`⛔ Команда '${prefix}${name}' недоступна для твоего уровня доступа`);
            return true;
        }
        try {
            await cmd.handler(ctx);
        } catch (e) {
            this.status.errors++;
            await ctx.reply(`❌ Ошибка выполнения команды: ${e.message}`).catch(() => {});
        }
        return true;
    }

    makeContext(msg, name, args, rest, level) {
        const client = this;
        const ctx = {
            client, msg, name, args, rest, level,
            replies: [],
            // LP-стиль как в TG: своё сообщение с командой редактируется, чужому отвечаем новым
            async reply(text) {
                ctx.replies.push(text);
                if (msg.fromTg) return null;
                if (msg.out && msg.messageId) {
                    await client.api('messages.edit', { peer_id: msg.peerId, message_id: msg.messageId, message: text, keep_forward_messages: 1 });
                    return msg.messageId;
                }
                return client.send(msg.peerId, text, { reply_to: msg.messageId });
            },
            async edit(messageId, text) {
                ctx.replies.push(text);
                if (msg.fromTg || !messageId) return null;
                return client.api('messages.edit', { peer_id: msg.peerId, message_id: messageId, message: text });
            },
            // Сообщение, на которое ответили командой: берём через messages.getById
            async getReply() {
                if (ctx._reply !== undefined) return ctx._reply;
                ctx._reply = null;
                if (msg.messageId && !msg.fromTg) {
                    const r = await client.api('messages.getById', { message_ids: msg.messageId });
                    const item = r && r.items && r.items[0];
                    ctx._reply = (item && item.reply_message) || null;
                }
                return ctx._reply;
            },
        };
        return ctx;
    }

    // VK → TG через handleCommand TG-бота. Сообщение-носитель команды создаётся в TG
    // (по умолчанию в «Избранном»), handleCommand его редактирует, как при обычном вызове в TG.
    // ДОПУЩЕНИЕ: в *тг_[id]_[команда] id — это TG-чат, где выполняется команда.
    async routeToTg(ctx, rest) {
        const bot = this.bot || {};
        const m = rest.match(/^(-?\d+)_(.+)$/);
        const chatId = m ? Number(m[1]) : (bot.botInfo && bot.botInfo.id);
        const command = (m ? m[2] : rest).toLowerCase();
        const tgPrefix = (bot.settings && bot.settings.prefix) || '';
        if (!bot.telegramClient || !bot.botInfo || typeof bot.handleCommand !== 'function') {
            return ctx.reply('❌ TG не авторизован, команда не выполнена');
        }
        if (!bot.commands || !bot.commands[command]) {
            return ctx.reply(`❌ TG команда '${tgPrefix}${command}' не найдена`);
        }
        const carrier = await bot.telegramClient.sendMessage(chatId, { message: `⏳ ${[tgPrefix + command, ...ctx.args].join(' ')} (из VK)` });
        await bot.handleCommand(command, ctx.args, carrier, chatId, bot.botInfo.id, carrier.id);
        return ctx.reply(`✅ Выполнено в TG: ${tgPrefix}${command} → чат ${chatId}`);
    }

    // TG → VK: вызывается из handleCommand TG для команд вида вк_[команда] и вк_[peerId]_[команда].
    // Возвращает текст для TG. Без peerId команда выполняется в своём VK-диалоге (peer = свой id).
    // opts.fromOwner обязателен: handleCommand TG ставит его, только если команду написал сам владелец.
    async runFromTg(rest, args = [], opts = {}) {
        if (!opts.fromOwner) return '⛔ Команды VK из TG доступны только владельцу';
        if (!this.running) return '❌ VK-клиент не запущен';
        const m = rest.match(/^(\d+)_(.+)$/);
        const peerId = m ? Number(m[1]) : this.ownerId;
        let name = (m ? m[2] : rest).toLowerCase();
        if (!this.commands.has(name) && this.commands.has('вк_' + name)) name = 'вк_' + name;
        const cmd = this.commands.get(name);
        if (!cmd) return `❌ VK команда '${this.config.prefix}${name}' не найдена`;
        const msg = { platform: 'vk', fromTg: true, out: true, peerId, fromId: this.ownerId, messageId: 0, text: `${this.config.prefix}${name} ${args.join(' ')}`.trim() };
        const ctx = this.makeContext(msg, name, args, args.join(' '), 'owner');
        try {
            await cmd.handler(ctx);
        } catch (e) {
            return `❌ VK: ${e.message}`;
        }
        return `✅ VK (peer ${peerId}): ${ctx.replies.join('\n') || 'выполнено'}`;
    }

    // ---------- входящие без команды: защита, капча, триггеры ----------
    async deleteForAll(msg) {
        try {
            await this.api('messages.delete', { peer_id: msg.peerId, message_ids: msg.messageId, delete_for_all: 1 });
            return true;
        } catch (e) {
            this.deps.log(`⚠️ VK защита: не удалось удалить сообщение ${msg.messageId}: ${e.message}`);
            return false;
        }
    }

    checkProtection(msg) {
        const p = this.state.protection;
        const isChat = msg.peerId > 2000000000;
        const text = msg.text || '';
        if (p['антискрин'] && msg.action === 'chat_screenshot') return 'антискрин';
        if (!isChat) return null;
        if (p['антибот'] && Number(msg.fromId) < 0) return 'антибот';
        if (p['антиlink'] && /(https?:\/\/|www\.|vk\.(cc|me)\/|t\.me\/)/i.test(text)) return 'антиlink';
        // ДОПУЩЕНИЕ: минимальный список корней, оригинального словаря нет
        if (p['антимат'] && /(^|[^а-яё])(х[уy][йеёяию]|пизд|[её]б[аеиоуы]|бля|муда?к)/i.test(text)) return 'антимат';
        const key = `${msg.peerId}:${msg.fromId}`;
        if (p['антифлуд']) {
            // ДОПУЩЕНИЕ: больше 5 сообщений за 10 секунд от одного человека
            const now = this.deps.now();
            const list = (this.floodTrack.get(key) || []).filter((t) => now - t < 10000);
            list.push(now);
            this.floodTrack.set(key, list);
            if (list.length > 5) return 'антифлуд';
        }
        if (p['антиспам'] && text) {
            // ДОПУЩЕНИЕ: третий одинаковый текст подряд от одного человека
            const prev = this.spamTrack.get(key) || { text: null, n: 0 };
            const n = prev.text === text ? prev.n + 1 : 1;
            this.spamTrack.set(key, { text, n });
            if (n >= 3) return 'антиспам';
        }
        return null;
    }

    async handleIncoming(msg) {
        const violation = this.checkProtection(msg);
        if (violation) {
            await this.deleteForAll(msg);
            return violation;
        }
        // Капча для новых собеседников в ЛС (ТЗ п. 6, ЗАЩИТА). ДОПУЩЕНИЕ по механике: пример на сложение,
        // пока ответа нет — сообщения собеседника удаляются у себя.
        if (this.state.protection['капча'] && msg.peerId < 2000000000 && msg.fromId > 0
            && !this.state.trusted[msg.fromId] && !this.state.captchaPassed.includes(msg.fromId)) {
            const pending = this.captchaPending.get(msg.fromId);
            if (pending && msg.text.trim() === String(pending)) {
                this.captchaPending.delete(msg.fromId);
                this.state.captchaPassed.push(msg.fromId);
                await this.saveState();
                await this.send(msg.peerId, '✅ Капча пройдена');
                return 'капча_ок';
            }
            if (!pending) {
                const a = 2 + Math.floor(Math.random() * 8);
                const b = 2 + Math.floor(Math.random() * 8);
                this.captchaPending.set(msg.fromId, a + b);
                await this.send(msg.peerId, `🤖 Капча: сколько будет ${a} + ${b}? Ответь числом.`);
            } else {
                await this.api('messages.delete', { peer_id: msg.peerId, message_ids: msg.messageId }).catch(() => {});
            }
            return 'капча';
        }
        const lower = (msg.text || '').toLowerCase();
        const trigger = lower && this.state.triggers.find((t) => lower.includes(t.word));
        if (trigger) {
            await this.send(msg.peerId, trigger.response, { reply_to: msg.messageId });
            return 'триггер';
        }
        return null;
    }

    // ---------- LP LOGGER ----------
    logToCache(msg) {
        const lg = this.state.lpLogger;
        if (msg.fromTg || lg.blocked.includes(Number(msg.fromId))) return;
        if (lg.whitelist && !msg.out && !this.state.trusted[Number(msg.fromId)]) return;
        this.lpCache.push({ peerId: msg.peerId, fromId: msg.fromId, messageId: msg.messageId, text: msg.text, at: this.deps.now() });
        if (this.lpCache.length > 1000) this.lpCache.shift();
    }

    async send(peerId, text, opts = {}) {
        const params = { peer_id: peerId, message: text, random_id: Math.floor(Math.random() * 2 ** 31), ...opts };
        if (!params.reply_to) delete params.reply_to;
        return this.api('messages.send', params);
    }
}

// =====================================================================
// Команды VK (ТЗ п. 6). Тексты ответов, приведённые в ТЗ дословно, взяты из ТЗ;
// поведение команд без описания в переписке — ДОПУЩЕНИЕ по образцу TG-обработчиков script.js.
// Карточки (canvas) и модули гориллы в этот проход не входят (ТЗ п. 6).
// =====================================================================
const SECTIONS = ['БАЗОВЫЕ', 'СООБЩЕНИЯ', 'VK СПЕЦ.', 'ЗАЩИТА', 'LP LOGGER', 'ВЛАДЕЛЕЦ', 'AI / OPENROUTER'];
const PROTECTION = ['антимат', 'антиlink', 'антискрин', 'антифлуд', 'антибот', 'капча', 'антиспам'];
const { isSecretPath } = require('./secret_files.js'); // общий список секретных файлов с TG-командами ‘код

function onOff(arg) {
    const a = String(arg || '').toLowerCase();
    if (['вкл', 'on', '1', 'да'].includes(a)) return true;
    if (['выкл', 'off', '0', 'нет'].includes(a)) return false;
    return null;
}

// Достаёт VK-цель из аргумента: 123, id123, [id123|Имя], @screen, vk.com/screen
function parseTarget(arg) {
    if (!arg) return null;
    const s = String(arg).trim();
    let m = s.match(/^\[id(\d+)\|/i) || s.match(/^(?:id)?(\d+)$/i);
    if (m) return m[1];
    m = s.match(/^(?:@|(?:https?:\/\/)?(?:m\.)?vk\.com\/)([A-Za-z0-9_.]+)$/i);
    return m ? m[1] : null;
}

async function resolveUser(ctx, arg) {
    let target = parseTarget(arg);
    if (!target) {
        const reply = await ctx.getReply();
        if (reply && reply.from_id > 0) target = String(reply.from_id);
    }
    if (!target) return null;
    const users = await ctx.client.api('users.get', { user_ids: target, fields: 'screen_name,photo_max' });
    return (users && users[0]) || null;
}

const fullName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim();
const NO_TARGET = '❌ Укажи ID, @юзернейм или ответь на сообщение'; // ТЗ п. 5.5

function registerDefaultCommands(client) {
    const reg = (name, section, usage, level, handler) => client.registerCommand(name, handler, { section, usage, level });
    const api = (m, p) => client.api(m, p);

    // ---------------- БАЗОВЫЕ ----------------
    reg('пинг', 'БАЗОВЫЕ', 'пинг', 1, async (ctx) => {
        const t0 = client.deps.now();
        const id = await ctx.reply('🏓 ...');
        await ctx.edit(id, `🏓 Понг! ${client.deps.now() - t0} мс`);
    });

    const help = async (ctx, arg) => {
        const all = [...client.commands.entries()];
        const p = client.config.prefix;
        const head = `LP Bot VK — ${all.length} команд, префикс ${p}`;
        const bySection = (sec) => all.filter(([, c]) => c.section === sec).map(([, c]) => `• ${p}${c.usage}`);
        const a = String(arg || '').toLowerCase();
        if (!a) {
            const lines = SECTIONS.map((sec, i) => `${i + 1}. ${sec} (${bySection(sec).length})`);
            return ctx.reply(`${head}\n\n${lines.join('\n')}\n\n${p}кмд [N] — раздел, ${p}кмд все — все команды, ${p}хелп [раздел]`);
        }
        if (a === 'все') {
            return ctx.reply(`${head}\n\n${SECTIONS.map((sec) => `${sec}\n${bySection(sec).join('\n')}`).join('\n\n')}`);
        }
        const n = Number(a);
        const sec = Number.isInteger(n) && n >= 1 ? SECTIONS[n - 1] : SECTIONS.find((s) => s.toLowerCase().startsWith(a));
        if (!sec) return ctx.reply(`❌ Раздел '${arg}' не найден. ${p}кмд — список разделов`);
        return ctx.reply(`${sec}\n${bySection(sec).join('\n')}`);
    };
    reg('кмд', 'БАЗОВЫЕ', 'кмд [N|все]', 1, (ctx) => help(ctx, ctx.args[0]));
    reg('хелп', 'БАЗОВЫЕ', 'хелп [раздел]', 1, (ctx) => help(ctx, ctx.rest));

    reg('триггер', 'БАЗОВЫЕ', 'триггер слово | ответ', 2, async (ctx) => {
        const [word, ...resp] = ctx.rest.split('|');
        const w = (word || '').trim().toLowerCase();
        const r = resp.join('|').trim();
        if (!w || !r) return ctx.reply(`❌ Формат: ${client.config.prefix}триггер слово | ответ`);
        const t = { id: client.state.nextTriggerId++, word: w, response: r };
        client.state.triggers.push(t);
        await client.saveState();
        return ctx.reply(`✅ Триггер #${t.id}: «${t.word}» → «${t.response}»`);
    });
    reg('триггеры', 'БАЗОВЫЕ', 'триггеры', 1, async (ctx) => {
        const list = client.state.triggers;
        if (!list.length) return ctx.reply('📋 Триггеров нет');
        return ctx.reply(`📋 Триггеры VK (${list.length}):\n${list.map((t) => `#${t.id} «${t.word}» → «${t.response}»`).join('\n')}`);
    });
    reg('дельтриггер', 'БАЗОВЫЕ', 'дельтриггер ID', 2, async (ctx) => {
        const id = Number(ctx.args[0]);
        const i = client.state.triggers.findIndex((t) => t.id === id);
        if (i < 0) return ctx.reply(`❌ Триггер #${ctx.args[0] || '?'} не найден`);
        client.state.triggers.splice(i, 1);
        await client.saveState();
        return ctx.reply(`🗑 Триггер #${id} удалён`);
    });

    // Шаблоны — общая таблица templates бота (как у TG); из VK только текстовые
    const bot = () => client.bot || {};
    reg('шаблон', 'БАЗОВЫЕ', 'шаблон название текст', 2, async (ctx) => {
        const [name, ...rest] = ctx.args;
        if (!name) return ctx.reply('❌ Укажите название шаблона');
        let text = rest.join(' ');
        if (!text) { const r = await ctx.getReply(); text = (r && r.text) || ''; }
        if (!text) return ctx.reply('❌ Укажи текст шаблона или ответь на сообщение');
        if (typeof bot().saveTemplateToDatabase !== 'function') return ctx.reply('❌ База шаблонов недоступна');
        await bot().saveTemplateToDatabase({ name, contentType: 'text', textContent: text, mediaData: null, fileName: null, mimeType: null });
        return ctx.reply(`💾 Шаблон "${name}" сохранён`);
    });
    reg('шаблоны', 'БАЗОВЫЕ', 'шаблоны', 1, async (ctx) => {
        if (typeof bot().getAllTemplates !== 'function') return ctx.reply('❌ База шаблонов недоступна');
        const rows = await bot().getAllTemplates();
        if (!rows.length) return ctx.reply('📋 Шаблонов нет');
        return ctx.reply(`📋 Шаблоны (${rows.length}):\n${rows.map((r) => `• ${r.name} (${r.content_type}, использован ${r.used_count || 0} раз)`).join('\n')}`);
    });
    reg('ш', 'БАЗОВЫЕ', 'ш название', 1, async (ctx) => {
        const name = ctx.args[0];
        if (!name) return ctx.reply('❌ Укажите название шаблона');
        if (typeof bot().getTemplateFromDatabase !== 'function') return ctx.reply('❌ База шаблонов недоступна');
        const t = await bot().getTemplateFromDatabase(name);
        if (!t) return ctx.reply(`❌ Шаблон "${name}" не найден`);
        if (t.content_type !== 'text') return ctx.reply(`⚠️ Шаблон "${name}" — ${t.content_type}, в VK отправляются только текстовые`);
        if (typeof bot().updateTemplateUsage === 'function') await bot().updateTemplateUsage(name);
        return ctx.reply(t.text_content);
    });

    // Доступ (ТЗ п. 5.4). Уровни 1–3 — ДОПУЩЕНИЕ: 1 базовые, 2 + сообщения, 3 + защита и LP LOGGER
    const access = async (ctx) => {
        const p = client.config.prefix;
        const [action, ...rest] = ctx.args;
        const act = String(action || '').toLowerCase();
        if (!act) {
            const ids = Object.keys(client.state.trusted);
            const footer = `Добавить: ${p}доступ добавить @юзер\nУдалить: ${p}доступ удалить @юзер`;
            if (!ids.length) return ctx.reply(`📋 Доверенных VK пользователей нет\n\n${footer}`);
            const users = await api('users.get', { user_ids: ids.join(','), fields: 'screen_name' });
            const lines = (users || []).map((u) => `• ${fullName(u)} ([id${u.id}|@${u.screen_name || 'id' + u.id}]) [${u.id}] — уровень ${client.state.trusted[u.id]}`);
            return ctx.reply(`📋 Доверенные VK пользователи:\n${lines.join('\n')}\n\n${footer}`);
        }
        if (ctx.level !== 'owner') return ctx.reply('⛔ Менять доступ может только владелец');
        if (['добавить', '+'].includes(act)) {
            const u = await resolveUser(ctx, rest[0]);
            if (!u) return ctx.reply(NO_TARGET);
            client.state.trusted[u.id] = client.state.trusted[u.id] || 1;
            await client.saveState();
            return ctx.reply(`✅ ${fullName(u)} (${u.id}) добавлен в доверенные`);
        }
        if (['удалить', '-'].includes(act)) {
            const u = await resolveUser(ctx, rest[0]);
            if (!u) return ctx.reply(NO_TARGET);
            delete client.state.trusted[u.id];
            await client.saveState();
            return ctx.reply(`🗑 ${fullName(u)} (${u.id}) удалён из доверенных`);
        }
        if (act === 'уровень') {
            const u = await resolveUser(ctx, rest[0]);
            const lvl = Number(rest[1]);
            if (!u) return ctx.reply(NO_TARGET);
            if (![1, 2, 3].includes(lvl)) return ctx.reply('❌ Уровень доступа: 1, 2 или 3');
            client.state.trusted[u.id] = lvl;
            await client.saveState();
            return ctx.reply(`✅ ${fullName(u)} (${u.id}): уровень доступа ${lvl}`);
        }
        return ctx.reply(`❌ Формат: ${p}доступ [добавить|удалить|уровень] @юзер`);
    };
    reg('доступ', 'БАЗОВЫЕ', 'доступ [+|-|добавить|удалить|уровень] [id]', 1, access);

    // ---------------- СООБЩЕНИЯ ----------------
    reg('смс', 'СООБЩЕНИЯ', 'смс [N]', 2, async (ctx) => {
        // Как deleteMessages в TG: команда удаляется всегда; ответ на сообщение — удаляется и оно;
        // N — ещё N своих последних сообщений. ДОПУЩЕНИЕ: только свои (out), не больше 100.
        const ids = [ctx.msg.messageId];
        const reply = await ctx.getReply();
        if (reply && reply.id && reply.from_id === client.ownerId) ids.push(reply.id);
        const n = Math.min(Number(ctx.args[0]) || 0, 100);
        if (n > 0) {
            const h = await api('messages.getHistory', { peer_id: ctx.msg.peerId, count: Math.min(n + 20, 200) });
            const own = (h.items || []).filter((m) => m.out && !ids.includes(m.id)).slice(0, n);
            ids.push(...own.map((m) => m.id));
        }
        await api('messages.delete', { peer_id: ctx.msg.peerId, message_ids: ids.join(','), delete_for_all: 1 });
    });
    reg('фейк', 'СООБЩЕНИЯ', 'фейк [текст]', 2, async (ctx) => {
        // ДОПУЩЕНИЕ: команда удаляется у всех, текст отправляется как обычное сообщение
        if (!ctx.rest) return ctx.reply('❌ Укажи текст');
        await api('messages.delete', { peer_id: ctx.msg.peerId, message_ids: ctx.msg.messageId, delete_for_all: 1 });
        await client.send(ctx.msg.peerId, ctx.rest);
    });
    reg('спам', 'СООБЩЕНИЯ', 'спам [N] [текст]', 2, async (ctx) => {
        const n = Number(ctx.args[0]);
        const text = ctx.args.slice(1).join(' ');
        // ДОПУЩЕНИЕ: не больше 50 за раз; темп ограничивает общий лимит 3 запроса/с
        if (!Number.isInteger(n) || n < 1 || n > 50 || !text) return ctx.reply(`❌ Формат: ${client.config.prefix}спам [1-50] [текст]`);
        await ctx.reply(`📨 Спам: ${n} × «${text}»`);
        for (let i = 0; i < n; i++) await client.send(ctx.msg.peerId, text);
    });
    for (const name of PROTECTION) {
        // антиспам в справке стоит в СООБЩЕНИЯХ, остальные — ЗАЩИТА (ТЗ п. 6)
        const section = name === 'антиспам' ? 'СООБЩЕНИЯ' : 'ЗАЩИТА';
        reg(name, section, `${name} вкл/выкл`, 3, async (ctx) => {
            let v = onOff(ctx.args[0]);
            if (v === null && ctx.args[0]) return ctx.reply(`❌ Формат: ${client.config.prefix}${name} вкл/выкл`);
            if (v === null) v = !client.state.protection[name];
            client.state.protection[name] = v;
            await client.saveState();
            return ctx.reply(`🛡 ${name}: ${v ? 'включено ✅' : 'выключено ❌'}`);
        });
    }
    reg('закреп', 'СООБЩЕНИЯ', 'закреп', 2, async (ctx) => {
        const reply = await ctx.getReply();
        if (!reply) return ctx.reply('❌ Ответь на сообщение, которое нужно закрепить');
        await api('messages.pin', { peer_id: ctx.msg.peerId, conversation_message_id: reply.conversation_message_id });
        return ctx.reply('📌 Сообщение закреплено');
    });
    reg('прочитать', 'СООБЩЕНИЯ', 'прочитать [все]', 2, async (ctx) => {
        if (String(ctx.args[0] || '').toLowerCase() === 'все') {
            const r = await api('messages.getConversations', { filter: 'unread', count: 200 });
            const peers = (r.items || []).map((i) => i.conversation.peer.id);
            for (const peer of peers) await api('messages.markAsRead', { peer_id: peer, mark_conversation_as_read: 1 });
            return ctx.reply(`✅ Прочитано диалогов: ${peers.length}`);
        }
        await api('messages.markAsRead', { peer_id: ctx.msg.peerId, mark_conversation_as_read: 1 });
        return ctx.reply('✅ Прочитано');
    });
    reg('автоудалить', 'СООБЩЕНИЯ', 'автоудалить [сек] [текст]', 2, async (ctx) => {
        const sec = Number(ctx.args[0]);
        const text = ctx.args.slice(1).join(' ');
        if (!Number.isFinite(sec) || sec < 1 || sec > 86400 || !text) return ctx.reply(`❌ Формат: ${client.config.prefix}автоудалить [1-86400] [текст]`);
        const id = await ctx.reply(text);
        client.deps.setTimeout(() => api('messages.delete', { peer_id: ctx.msg.peerId, message_ids: id, delete_for_all: 1 }).catch(() => {}), sec * 1000);
    });

    // ---------------- VK СПЕЦ. ----------------
    reg('о_чате', 'VK СПЕЦ.', 'о_чате', 1, async (ctx) => {
        const peer = ctx.msg.peerId;
        if (peer > 2000000000) {
            const r = await api('messages.getConversationsById', { peer_ids: peer });
            const c = r.items && r.items[0];
            const s = (c && c.chat_settings) || {};
            return ctx.reply(`💬 ${s.title || 'Беседа'} • ID: ${peer}${s.members_count ? ` • участников: ${s.members_count}` : ''}`); // ТЗ п. 6, L31130
        }
        const [u] = await api('users.get', { user_ids: peer });
        return ctx.reply(`💬 ЛС с ${u ? fullName(u) : peer} • ID: ${peer}`);
    });
    reg('айди', 'VK СПЕЦ.', 'айди [id]', 1, async (ctx) => {
        const u = await resolveUser(ctx, ctx.args[0]);
        if (!u) return ctx.reply(NO_TARGET);
        return ctx.reply(`👤 ${fullName(u)} • vk.com/${u.screen_name || 'id' + u.id}\n🆔 ${u.id}`); // ТЗ п. 6, L31372 (фото — следующим проходом)
    });
    reg('инвайт', 'VK СПЕЦ.', 'инвайт', 2, async (ctx) => {
        if (ctx.msg.peerId < 2000000000) return ctx.reply('❌ Ссылка-приглашение есть только у беседы');
        const r = await api('messages.getInviteLink', { peer_id: ctx.msg.peerId, reset: 0 });
        return ctx.reply(`🔗 ${r.link}`);
    });
    reg('упомянуть', 'VK СПЕЦ.', 'упомянуть [текст]', 2, async (ctx) => {
        if (ctx.msg.peerId < 2000000000) return ctx.reply('❌ Упоминание всех работает только в беседе');
        const r = await api('messages.getConversationMembers', { peer_id: ctx.msg.peerId });
        const people = (r.profiles || []).filter((p) => p.id !== client.ownerId);
        const mentions = people.map((p) => `[id${p.id}|${p.first_name}]`).join(', ');
        return client.send(ctx.msg.peerId, `${mentions}${ctx.rest ? `\n${ctx.rest}` : ''}`);
    });
    reg('онлайн', 'VK СПЕЦ.', 'онлайн вкл/выкл', 2, async (ctx) => {
        const v = onOff(ctx.args[0]);
        if (v === null) return ctx.reply(`🟢 Вечный онлайн: ${client.state.online ? 'включён' : 'выключен'}`);
        client.state.online = v;
        if (v) client.state.invisible = false;
        await client.setOnline(v);
        await client.saveState();
        return ctx.reply(`🟢 Вечный онлайн: ${v ? 'включён ✅' : 'выключен ❌'}`);
    });
    reg('невидимка', 'VK СПЕЦ.', 'невидимка вкл/выкл', 2, async (ctx) => {
        const v = onOff(ctx.args[0]);
        if (v === null) return ctx.reply(`👻 Невидимка: ${client.state.invisible ? 'включена' : 'выключена'}`);
        client.state.invisible = v;
        if (v) {
            client.state.online = false;
            await client.setOnline(false);
            await api('account.setOffline', {});
        }
        await client.saveState();
        return ctx.reply(`👻 Невидимка: ${v ? 'включена ✅' : 'выключена ❌'}`);
    });
    reg('геолокация', 'VK СПЕЦ.', 'геолокация [город]', 2, async (ctx) => {
        if (!ctx.rest) return ctx.reply('❌ Укажи город');
        // ДОПУЩЕНИЕ: координаты города берём из OpenStreetMap Nominatim, через тот же прокси
        const { data } = await client.http.get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(ctx.rest)}`,
            { headers: { 'User-Agent': 'lpbot' } });
        const place = Array.isArray(data) && data[0];
        if (!place) return ctx.reply(`❌ Город «${ctx.rest}» не найден`);
        await client.send(ctx.msg.peerId, `📍 ${ctx.rest}`, { lat: Number(place.lat), long: Number(place.lon) });
    });

    // ---------------- ЗАЩИТА: вк_доступ ----------------
    reg('вк_доступ', 'ЗАЩИТА', 'вк_доступ [добавить|удалить] [vk_id]', 1, access);

    // ---------------- LP LOGGER ----------------
    // ДОПУЩЕНИЕ по смыслу: кэш последних сообщений из long poll; whitelist — писать только своих и доверенных
    const lpStatus = (ctx) => {
        const s = client.status;
        const last = s.lastEventAt ? `${Math.round((client.deps.now() - s.lastEventAt) / 1000)} с назад` : 'нет';
        return ctx.reply(`📡 VK LP: ${s.connected ? 'подключён ✅' : 'не подключён ❌'}\nts: ${s.ts || '—'}\nПоследнее событие: ${last}\nОшибок: ${s.errors}\nКапч: ${s.captchas}`);
    };
    reg('лп', 'LP LOGGER', 'лп [whitelist вкл|выкл | блок id | разблок id | обновить | кэш]', 3, async (ctx) => {
        const [sub, arg, arg2] = ctx.args.map((a) => String(a || '').toLowerCase());
        const lg = client.state.lpLogger;
        if (sub === 'whitelist') {
            const v = onOff(arg);
            if (v === null) return ctx.reply(`📒 LP whitelist: ${lg.whitelist ? 'включён' : 'выключен'}`);
            lg.whitelist = v;
            await client.saveState();
            return ctx.reply(`📒 LP whitelist: ${v ? 'включён ✅' : 'выключен ❌'}`);
        }
        if (sub === 'блок' || sub === 'разблок') {
            const id = Number(parseTarget(arg));
            if (!id) return ctx.reply(NO_TARGET);
            lg.blocked = lg.blocked.filter((x) => x !== id);
            if (sub === 'блок') { lg.blocked.push(id); client.lpCache = client.lpCache.filter((m) => Number(m.fromId) !== id); }
            await client.saveState();
            return ctx.reply(sub === 'блок' ? `🚫 ${id} не логируется` : `✅ ${id} снова логируется`);
        }
        if (sub === 'обновить') {
            client.lp = null; // pollLoop заново возьмёт getLongPollServer
            return ctx.reply('🔄 LP-сервер будет переподключён');
        }
        if (sub === 'кэш') {
            if (arg === 'очистить') { client.lpCache = []; return ctx.reply('🧹 Кэш LP очищен'); }
            return ctx.reply(`📒 Кэш LP: ${client.lpCache.length} сообщений (максимум 1000)`);
        }
        return ctx.reply(`❌ Формат: ${client.config.prefix}лп whitelist вкл|выкл | блок [id] | разблок [id] | обновить | кэш`);
    });
    reg('лп_статус', 'LP LOGGER', 'лп_статус', 3, lpStatus);
    reg('лп_поиск', 'LP LOGGER', 'лп_поиск [текст]', 3, async (ctx) => {
        const q = ctx.rest.toLowerCase();
        if (!q) return ctx.reply('❌ Укажи текст для поиска');
        const found = client.lpCache.filter((m) => m.text && m.text.toLowerCase().includes(q) && !m.text.startsWith(client.config.prefix)).slice(-10);
        if (!found.length) return ctx.reply(`🔍 «${ctx.rest}»: ничего не найдено`);
        return ctx.reply(`🔍 «${ctx.rest}» (${found.length}):\n${found.map((m) => `• [${m.peerId}] ${m.fromId}: ${m.text.slice(0, 100)}`).join('\n')}`);
    });

    // ---------------- ВЛАДЕЛЕЦ ----------------
    reg('адм', 'ВЛАДЕЛЕЦ', 'адм', 'owner', async (ctx) => {
        const on = PROTECTION.filter((p) => client.state.protection[p]);
        const up = Math.round((client.deps.now() - client.startedAt) / 60000);
        return ctx.reply([
            '👑 Панель владельца VK',
            `Аккаунт: id${client.ownerId || '?'}`,
            `Аптайм: ${up} мин`,
            `LP: ${client.status.connected ? 'подключён' : 'не подключён'}`,
            `Доверенных: ${Object.keys(client.state.trusted).length}`,
            `Триггеров: ${client.state.triggers.length}`,
            `Защита: ${on.length ? on.join(', ') : 'выключена'}`,
            `Онлайн: ${client.state.online ? 'вкл' : 'выкл'}, невидимка: ${client.state.invisible ? 'вкл' : 'выкл'}`,
        ].join('\n'));
    });
    // Секреты: команду с токеном удаляем, токен никогда не выводим (ни в VK, ни в лог)
    const dropCommand = (ctx) => (ctx.msg.messageId ? api('messages.delete', { peer_id: ctx.msg.peerId, message_ids: ctx.msg.messageId, delete_for_all: 1 }).catch(() => {}) : null);
    reg('вк_токен', 'ВЛАДЕЛЕЦ', 'вк_токен [token]', 'owner', async (ctx) => {
        const t = ctx.args[0];
        if (!t) return ctx.reply(`🔑 VK-токен: ${client.token ? 'задан' : 'не задан'}`);
        await dropCommand(ctx);
        if (!/^vk1\.a\.[\w-]+$/.test(t) && !/^[a-f0-9]{85}$/i.test(t)) return client.send(ctx.msg.peerId, '❌ Это не похоже на токен VK (ожидается vk1.a...)');
        client.state.userToken = t;
        client.token = t;
        await client.saveState();
        return client.send(ctx.msg.peerId, '✅ VK-токен сохранён в БД, команда с ним удалена');
    });
    reg('вк_группа', 'ВЛАДЕЛЕЦ', 'вк_группа [id] [token]', 'owner', async (ctx) => {
        const [id, t] = ctx.args;
        if (!id) return ctx.reply(client.state.group ? `👥 VK-группа: ${client.state.group.id}, токен задан` : '👥 VK-группа не настроена');
        if (!/^\d+$/.test(id) || !t) return ctx.reply(`❌ Формат: ${client.config.prefix}вк_группа [id] [token]`);
        await dropCommand(ctx);
        client.state.group = { id: Number(id), token: t };
        await client.saveState();
        // Запуск группового клиента в этот проход не входит: настройка только сохраняется
        return client.send(ctx.msg.peerId, `✅ VK-группа ${id} сохранена, команда с токеном удалена`);
    });
    reg('вк_настройки', 'ВЛАДЕЛЕЦ', 'вк_настройки', 'owner', async (ctx) => {
        const c = client.config;
        return ctx.reply([
            '⚙️ Настройки VK',
            `Префикс: ${c.prefix}`,
            `Прокси: ${c.proxy || 'выключен'}`,
            `API: ${c.apiVersion}, лимит ${c.maxRequestsPerSecond} запроса/с`,
            `Токен: ${client.token ? 'задан' : 'не задан'}`,
            `Группа: ${client.state.group ? client.state.group.id : 'нет'}`,
            `OpenRouter: ключ ${client.state.openrouter.key ? 'задан' : 'не задан'}, модель ${client.state.openrouter.model}`,
        ].join('\n'));
    });
    reg('вк_лп_статус', 'ВЛАДЕЛЕЦ', 'вк_лп_статус', 'owner', lpStatus);
    reg('сессии', 'ВЛАДЕЛЕЦ', 'сессии', 'owner', async (ctx) => {
        const b = bot();
        const tg = b.botInfo ? `авторизован (@${b.botInfo.username || b.botInfo.firstName || b.botInfo.id})` : 'не авторизован';
        return ctx.reply(`📱 Сессии\nTG: ${tg}\nVK: ${client.running ? `запущен (id${client.ownerId})` : 'не запущен'}`);
    });
    reg('код', 'ВЛАДЕЛЕЦ', 'код показать [файл] [с-по]', 'owner', async (ctx) => {
        // В VK только просмотр; правка кода — TG-командой ‘код (manageCode)
        const [action, file, range] = ctx.args;
        if (String(action || '').toLowerCase() !== 'показать' || !file) {
            return ctx.reply(`📄 ${client.config.prefix}код показать [файл] [с-по] — просмотр до 50 строк. Правка кода — только из TG`);
        }
        const path = require('path');
        const fs = require('fs');
        const base = path.resolve(__dirname);
        const full = path.resolve(base, file);
        if (!full.startsWith(base + path.sep) || full.includes(`${path.sep}node_modules${path.sep}`)) return ctx.reply('❌ Можно смотреть только файлы бота');
        if (isSecretPath(path.relative(base, full))) return ctx.reply('⛔ Этот файл содержит секреты, его не показываю');
        if (!fs.existsSync(full)) return ctx.reply(`❌ Файл ${file} не найден`);
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
        const [a, b2] = String(range || '1-50').split('-').map(Number);
        const from = Math.max(1, a || 1);
        const to = Math.min(lines.length, b2 || from + 49, from + 49);
        return ctx.reply(`📄 ${file} (${from}-${to} из ${lines.length})\n${lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n')}`);
    });
    reg('debug_triggers', 'ВЛАДЕЛЕЦ', 'debug_triggers', 'owner', async (ctx) => {
        // Лимит VK на сообщение 4096 символов: длинный список обрезаем
        const tail = `\nnextTriggerId: ${client.state.nextTriggerId}`;
        const raw = JSON.stringify(client.state.triggers);
        const max = 4000 - tail.length;
        const body = raw.length > max ? `${raw.slice(0, max - 40)}… (обрезано, всего ${raw.length} символов)` : raw;
        return ctx.reply(`🐞 Триггеры VK: ${body}${tail}`);
    });

    // ---------------- AI / OPENROUTER ----------------
    // ДОПУЩЕНИЕ: ор, ор_статус и ор_помощь — уровень 3 (запросы тратят ключ владельца), ор_ключ и ор_модель — только владелец
    const orKey = () => process.env.OPENROUTER_API_KEY || client.state.openrouter.key || '';
    reg('ор', 'AI / OPENROUTER', 'ор [запрос]', 3, async (ctx) => {
        if (!ctx.rest) return ctx.reply('❌ Укажи запрос');
        if (!orKey()) return ctx.reply(`❌ Ключ OpenRouter не задан: ${client.config.prefix}ор_ключ [api_key]`);
        const id = await ctx.reply('🤖 Думаю...');
        // ДОПУЩЕНИЕ: OpenRouter — не VK, идёт напрямую, без tor
        if (!client.aiHttp) client.aiHttp = (client.deps.axios || require('axios')).create({ timeout: 60000 });
        client.aiRequests++;
        const { data } = await client.aiHttp.post('https://openrouter.ai/api/v1/chat/completions',
            { model: client.state.openrouter.model, messages: [{ role: 'user', content: ctx.rest }] },
            { headers: { Authorization: `Bearer ${orKey()}`, 'Content-Type': 'application/json' } });
        const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        return ctx.edit(id, answer ? `🤖 ${String(answer).slice(0, 4000)}` : '❌ OpenRouter вернул пустой ответ');
    });
    reg('ор_ключ', 'AI / OPENROUTER', 'ор_ключ [api_key]', 'owner', async (ctx) => {
        const k = ctx.args[0];
        if (!k) return ctx.reply(`🔑 Ключ OpenRouter: ${orKey() ? 'задан' : 'не задан'}`);
        await dropCommand(ctx);
        client.state.openrouter.key = k;
        await client.saveState();
        return client.send(ctx.msg.peerId, '✅ Ключ OpenRouter сохранён, команда с ним удалена');
    });
    reg('ор_статус', 'AI / OPENROUTER', 'ор_статус', 3, async (ctx) => {
        return ctx.reply(`🤖 OpenRouter\nКлюч: ${orKey() ? 'задан' : 'не задан'}\nМодель: ${client.state.openrouter.model}\nЗапросов с запуска: ${client.aiRequests}`);
    });
    reg('ор_модель', 'AI / OPENROUTER', 'ор_модель [модель]', 'owner', async (ctx) => {
        const m = ctx.args[0];
        if (!m) return ctx.reply(`🤖 Модель: ${client.state.openrouter.model}`);
        if (!/^[\w.-]+\/[\w.:-]+$/.test(m)) return ctx.reply('❌ Модель в формате провайдер/модель, например deepseek/deepseek-chat');
        client.state.openrouter.model = m;
        await client.saveState();
        return ctx.reply(`✅ Модель OpenRouter: ${m}`);
    });
    reg('ор_помощь', 'AI / OPENROUTER', 'ор_помощь', 3, (ctx) => help(ctx, 'ai'));
}

module.exports = VkClient;
module.exports.VkClient = VkClient;
module.exports.VkApiError = VkApiError;
