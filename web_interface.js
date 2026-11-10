const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

const LOG_LIMIT = 500;

function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

class WebInterface {
    // host: адрес, на котором слушает панель. По умолчанию только локальная петля 127.0.0.1,
    // наружу панель открывается только явно через panelHost в config.json.
    constructor(bot, db, port = 3001, host = '127.0.0.1', token = null) {
        this.bot = bot;
        this.db = db || (bot && bot.db);
        this.port = port;
        this.host = host || '127.0.0.1';
        this.server = null;
        this.wss = null;
        this.logs = [];

        // Токен авторизации панели управления (Bearer / Cookie / Query)
        this.token = token || (bot && (bot.panelToken || (bot.config && bot.config.panelToken))) || process.env.PANEL_TOKEN;
        if (!this.token) {
            this.token = crypto.randomBytes(32).toString('hex');
        }
        if (this.bot) {
            this.bot.panelToken = this.token;
        }

        this.captureConsole();

        this.app = express();

        this.setupMiddleware();
        this.setupRoutes();
    }

    // Буфер последних строк консоли для /logs и /api/logs
    captureConsole() {
        if (console.__lpWebCaptured) return;
        const levels = { log: 'info', info: 'info', warn: 'warning', error: 'error' };
        for (const [method, level] of Object.entries(levels)) {
            const original = console[method].bind(console);
            console[method] = (...args) => {
                original(...args);
                const message = args.map(a => (typeof a === 'string' ? a : (a instanceof Error ? a.stack || a.message : safeStringify(a)))).join(' ');
                this.logs.push({ time: new Date().toISOString(), level, message });
                if (this.logs.length > LOG_LIMIT) this.logs.shift();
            };
        }
        console.__lpWebCaptured = true;
    }

    setupMiddleware() {
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, 'views'));

        // Заголовки безопасности: CSP, X-Frame-Options, X-Content-Type-Options
        this.app.use((req, res, next) => {
            res.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*; img-src 'self' data:; frame-ancestors 'none';"
            );
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            next();
        });

        // Статика стилей до авторизации (для отображения страницы 401 и favicon)
        this.app.use('/css', express.static(path.join(__dirname, 'public/css')));

        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // 1. Защита от CSRF: проверка Origin для мутирующих запросов
        this.app.use((req, res, next) => {
            if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method)) {
                const origin = req.headers['origin'];
                const host = req.headers['host'];
                if (origin) {
                    try {
                        const originHost = new URL(origin).host;
                        if (originHost !== host && originHost !== `127.0.0.1:${this.port}` && originHost !== `localhost:${this.port}`) {
                            console.warn(`⛔ [SECURITY CSRF] Отклонён запрос с чужого Origin: ${origin} (Host: ${host})`);
                            return res.status(403).json({ success: false, message: 'Forbidden: invalid origin (CSRF protection)' });
                        }
                    } catch (e) {
                        return res.status(403).json({ success: false, message: 'Forbidden: malformed origin' });
                    }
                }
            }
            next();
        });

        // 2. Авторизация по Bearer-токену, cookie и query параметру
        this.app.use((req, res, next) => {
            const authHeader = req.headers['authorization'];
            const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

            const cookieHeader = req.headers['cookie'] || '';
            const cookieToken = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('lp_auth_token='))?.split('=')[1];

            const queryToken = req.query.token ? String(req.query.token).trim() : null;

            const incomingToken = bearerToken || cookieToken || queryToken;

            if (incomingToken && safeCompare(incomingToken, this.token)) {
                if (queryToken) {
                    res.setHeader('Set-Cookie', `lp_auth_token=${this.token}; Path=/; HttpOnly; SameSite=Strict`);
                }
                return next();
            }

            if (req.xhr || req.path.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('application/json'))) {
                return res.status(401).json({ success: false, message: 'Unauthorized: missing or invalid token' });
            }

            res.status(401).send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <title>401 Unauthorized - lpbot</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body style="padding: 2rem; font-family: sans-serif; background: #f8fafc; color: #1e293b;">
    <div style="max-width: 500px; margin: 3rem auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
        <h2>🔒 Доступ ограничен</h2>
        <p>Для доступа к веб-панели управления требуется авторизационный токен.</p>
        <p>Используйте ссылку для входа из консоли бота:<br><code>http://${this.host}:${this.port}/?token=ВАШ_ТОКЕН</code></p>
    </div>
</body>
</html>`);
        });

        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    // Общие данные, которые нужны всем шаблонам с меню
    base(extra = {}) {
        return { bot: this.bot, prefix: this.bot.settings.prefix, ...extra };
    }

    triggersList() {
        const triggers = this.bot.settings.triggers instanceof Map ? [...this.bot.settings.triggers.values()] : [];
        return triggers.map(t => ({
            word: t.word,
            responses: Array.isArray(t.responses) ? t.responses : [],
            settings: t.settings || {}
        }));
    }

    async templatesList() {
        try {
            return await this.bot.getAllTemplates();
        } catch (error) {
            console.error('❌ Ошибка загрузки шаблонов:', error.message);
            return [];
        }
    }

    getVkStatus() {
        if (!this.bot || !this.bot.vkClient) {
            return { state: 'disabled', text: 'Не настроен', detail: 'Модуль VK не загружен', connected: false };
        }
        const vk = this.bot.vkClient;
        const s = vk.status || {};
        if (!vk.token && !vk.running) {
            return { state: 'disabled', text: 'Не настроен', detail: 'Токен VK не задан', connected: false };
        }
        if (vk.running && s.connected) {
            return { state: 'connected', text: 'Активен', detail: 'Long Poll подключен • Туннель :1080 OK', connected: true };
        }
        if (vk.running && (vk.captchaStreak > 0 || (s.errors > 0 && !s.connected))) {
            const detail = vk.captchaStreak > 0 ? 'Пауза: капча-бэкофф' : 'Ожидание Long Poll...';
            return { state: 'warning', text: 'Переподключение', detail, connected: false };
        }
        if (vk.running && !s.connected) {
            return { state: 'error', text: 'Сбой соединения', detail: 'Ошибка связи с VK / туннелем', connected: false };
        }
        return { state: 'disabled', text: 'Остановлен', detail: 'Клиент остановлен', connected: false };
    }

    commandsList() {
        return Object.keys(this.bot.commands || {}).sort().map(name => ({
            name,
            description: '',
            category: 'общая'
        }));
    }

    setupRoutes() {
        const page = (view, getData) => async (req, res, next) => {
            try {
                res.render(view, await getData(req));
            } catch (error) {
                next(error);
            }
        };

        this.app.get('/', page('index', () => this.base({ stats: this.getStats(), uptime: process.uptime() })));

        this.app.get('/templates', page('templates', async () => {
            const templates = await this.templatesList();
            return this.base({
                templates,
                total: templates.length,
                getTemplateTypeIcon: type => this.bot.getTemplateTypeIcon(type),
                getTemplateTypeName: type => this.bot.getTemplateTypeDescription({ content_type: type })
            });
        }));

        this.app.get('/settings', page('settings', () => this.base({ settings: this.bot.settings })));

        this.app.get('/triggers', page('triggers', () => {
            const triggers = this.triggersList();
            return this.base({ triggers, total: triggers.length });
        }));

        this.app.get('/commands', page('commands', () => {
            const commands = this.commandsList();
            const categories = {};
            for (const command of commands) {
                (categories[command.category] = categories[command.category] || []).push(command);
            }
            return this.base({ commands, categories });
        }));

        this.app.get('/deepseek', page('deepseek', () => this.base({ deepseek: this.bot.settings.deepseek || {} })));

        this.app.get('/logs', page('logs', () => this.base()));

        this.app.get('/stats', page('stats', async () => {
            const s = this.getStats();
            return this.base({
                connection: s.connected,
                memory: s.memoryMb,
                startTime: this.bot.startTime || new Date(),
                templates: (await this.templatesList()).length,
                timers: s.timers,
                triggers: s.activeTriggers,
                uptime: s.uptimeText
            });
        }));

        this.app.get('/export', page('export', async () => this.base({
            templatesCount: (await this.templatesList()).length,
            triggersCount: this.triggersList().length
        })));

        // ---- API ----
        this.app.get('/status', (req, res) => {
            const s = this.getStats();
            res.json({
                status: s.connected ? 'running' : 'stopped',
                ...s,
                uptime: s.uptimeText,
                memory: s.memoryMb,
                triggers: s.activeTriggers,
                connection: s.connected,
                vkConnected: this.bot.vkClient ? Boolean(this.bot.vkClient.status && this.bot.vkClient.status.connected) : null,
                vkEvents: this.bot.vkClient ? (this.bot.vkClient.status ? this.bot.vkClient.status.events : 0) : null,
                vkStatus: this.getVkStatus()
            });
        });

        this.app.get('/api/stats', async (req, res) => {
            const templates = await this.templatesList();
            const triggers = this.triggersList();
            const uses = t => Number((t.settings && t.settings.used) || 0);
            const popular = triggers.slice().sort((a, b) => uses(b) - uses(a))[0];
            const today = new Date(); today.setHours(0, 0, 0, 0);
            res.json({
                ...this.getStats(),
                templates: templates.length,
                textTemplates: templates.filter(t => t.content_type === 'text').length,
                mediaTemplates: templates.filter(t => t.content_type !== 'text').length,
                templateUses: templates.reduce((sum, t) => sum + (t.used_count || 0), 0),
                triggerUses: triggers.reduce((sum, t) => sum + uses(t), 0),
                popularTrigger: popular && uses(popular) > 0 ? { word: popular.word, used: uses(popular) } : null,
                todayErrors: this.logs.filter(l => l.level === 'error' && new Date(l.time) >= today).length,
                nodeVersion: process.version,
                // VK long poll: только счётчики, без текста сообщений
                vkEvents: this.bot.vkClient ? this.bot.vkClient.status.events : null,
                vkConnected: this.bot.vkClient ? this.bot.vkClient.status.connected : null,
                vkStatus: this.getVkStatus()
            });
        });

        this.app.get('/api/commands', (req, res) => {
            res.json({ prefix: this.bot.settings.prefix, commands: this.commandsList() });
        });

        // Без ключей и секретов: только то, что показывает GUI
        this.app.get('/api/settings', (req, res) => {
            const s = this.bot.settings;
            res.json({ prefix: s.prefix, notifications: Boolean(s.notifications), autoStatus: Boolean(s.autoStatus) });
        });

        this.app.get('/api/templates', async (req, res) => {
            res.json({ templates: await this.templatesList() });
        });

        this.app.delete('/api/templates/:name', async (req, res) => {
            const name = req.params.name;
            try {
                const changes = await new Promise((resolve, reject) => {
                    this.bot.db.run('DELETE FROM templates WHERE name = ?', [name], function (err) {
                        err ? reject(err) : resolve(this.changes);
                    });
                });
                if (this.bot.settings.templates instanceof Map) this.bot.settings.templates.delete(name);
                if (!changes) return res.json({ success: false, message: `Шаблон "${name}" не найден` });
                this.broadcast({ type: 'update', entity: 'templates' });
                res.json({ success: true, message: `Шаблон "${name}" удалён` });
            } catch (error) {
                console.error('❌ Ошибка удаления шаблона:', error.message);
                res.status(500).json({ success: false, message: 'Ошибка удаления шаблона' });
            }
        });

        this.app.get('/api/triggers', (req, res) => {
            res.json({ triggers: this.triggersList() });
        });

        this.app.post('/triggers', async (req, res) => {
            const word = String(req.body.word || '').trim();
            const responses = (Array.isArray(req.body.responses) ? req.body.responses : String(req.body.responses || '').split('|'))
                .map(r => String(r).trim()).filter(Boolean);
            if (!word || responses.length === 0) {
                return res.json({ success: false, message: 'Нужно слово и хотя бы один ответ' });
            }
            try {
                const trigger = { word, responses, settings: {} };
                await this.bot.saveTriggerToDatabase(trigger);
                this.bot.settings.triggers.set(word.toLowerCase(), trigger);
                await this.bot.saveAllData();
                this.broadcast({ type: 'update', entity: 'triggers' });
                res.json({ success: true, message: 'Триггер добавлен' });
            } catch (error) {
                console.error('❌ Ошибка добавления триггера:', error.message);
                res.status(500).json({ success: false, message: 'Ошибка добавления триггера' });
            }
        });

        this.app.delete('/triggers/:word', async (req, res) => {
            const key = String(req.params.word).toLowerCase();
            const trigger = this.bot.settings.triggers.get(key);
            if (!trigger) return res.json({ success: false, message: `Триггер "${req.params.word}" не найден` });
            try {
                await new Promise((resolve, reject) => {
                    this.bot.db.run('DELETE FROM triggers WHERE word = ?', [trigger.word], err => err ? reject(err) : resolve());
                });
                this.bot.settings.triggers.delete(key);
                await this.bot.saveAllData();
                this.broadcast({ type: 'update', entity: 'triggers' });
                res.json({ success: true, message: 'Триггер удалён' });
            } catch (error) {
                console.error('❌ Ошибка удаления триггера:', error.message);
                res.status(500).json({ success: false, message: 'Ошибка удаления триггера' });
            }
        });

        // Сохранение настроек: принимает любую из трёх форм страницы /settings
        this.app.post('/settings', (req, res) => {
            const body = req.body || {};
            const s = this.bot.settings;
            const flags = ['notifications', 'autoStatus', 'autoReadMentions', 'autoAddFriends', 'autoLeaveChats', 'dynamicCover', 'muteChat'];
            try {
                const isOn = value => value === 'on' || value === true || value === 'true';
                if (body.prefix !== undefined) {
                    let prefix = String(body.prefix || '').replace(/\s+/g, '');
                    prefix = prefix.replace(/['’ʼ`]/g, '‘');
                    if (!prefix || prefix.length > 3 || /[\p{L}\p{N}]/u.test(prefix)) {
                        return res.json({ success: false, message: 'Префикс: от 1 до 3 спецсимволов без букв и пробелов' });
                    }
                    s.prefix = prefix;
                    if (this.bot.vkClient && typeof this.bot.vkClient.setPrefix === 'function') {
                        this.bot.vkClient.setPrefix(prefix);
                    }
                }
                // Форма страницы /settings шлёт только включённые галочки, остальные выключаем.
                // GUI и прочие клиенты меняют только те флаги, которые прислали.
                for (const flag of flags) {
                    if (body.form === 'main') s[flag] = isOn(body[flag]);
                    else if (body[flag] !== undefined) s[flag] = isOn(body[flag]);
                }
                if (body.form === 'custom') {
                    for (const key of ['botName', 'creator', 'version', 'status', 'uptime']) {
                        s.customValues[key] = body[key] ? String(body[key]) : null;
                    }
                }
                if (body.form === 'autostatus') {
                    const mode = parseInt(body.mode, 10);
                    const interval = parseInt(body.interval, 10);
                    if (![1, 2, 3].includes(mode) || !(interval > 0)) return res.json({ success: false, message: 'Неверный режим или интервал' });
                    s.autoStatusSettings = { ...s.autoStatusSettings, mode, interval };
                }
                this.bot.saveSettings();
                this.broadcast({ type: 'update', entity: 'settings' });
                res.json({ success: true, message: 'Настройки сохранены' });
            } catch (error) {
                console.error('❌ Ошибка сохранения настроек:', error.message);
                res.status(500).json({ success: false, message: 'Ошибка сохранения настроек' });
            }
        });

        this.app.post('/deepseek', (req, res) => {
            const body = req.body || {};
            const d = this.bot.settings.deepseek = this.bot.settings.deepseek || {};
            const apiKey = String(body.apiKey || '').trim();
            // Пустое поле или маска «••••» — ключ не меняем
            if (apiKey && !/^•+$/.test(apiKey)) d.apiKey = apiKey;
            d.enabled = body.enabled === 'on' || body.enabled === true || body.enabled === 'true';
            if (['deepseek-chat', 'deepseek-coder'].includes(body.model)) d.model = body.model;
            const maxTokens = parseInt(body.maxTokens, 10);
            if (maxTokens > 0) d.maxTokens = maxTokens;
            const temperature = parseFloat(body.temperature);
            if (temperature >= 0 && temperature <= 2) d.temperature = temperature;
            this.bot.saveSettings();
            res.json({ success: true, message: 'Настройки DeepSeek сохранены' });
        });

        // Проверка ключа DeepSeek реальным запросом к API
        this.app.post('/api/deepseek/test', async (req, res) => {
            const d = this.bot.settings.deepseek || {};
            if (!d.apiKey) return res.json({ success: false, message: 'Сначала установите API ключ' });
            const prompt = String((req.body && req.body.message) || 'ping').slice(0, 2000);
            try {
                const answer = await this.bot.callDeepSeekAPI(prompt);
                res.json({ success: true, message: 'Подключение успешно', answer, model: d.model });
            } catch (error) {
                const status = error.response ? ` (HTTP ${error.response.status})` : '';
                res.json({ success: false, message: `Ошибка DeepSeek${status}: ${error.message}` });
            }
        });

        this.app.get('/api/logs', (req, res) => {
            res.json({ logs: this.logs });
        });

        this.app.delete('/api/logs', (req, res) => {
            this.logs.length = 0;
            res.json({ success: true });
        });

        // 404 и ошибки
        this.app.use((req, res) => {
            res.status(404).render('404', { url: req.originalUrl });
        });

        this.app.use((error, req, res, next) => {
            console.error('❌ Ошибка веб-интерфейса:', error);
            if (res.headersSent) return next(error);
            res.status(500).render('error', { error: 'Внутренняя ошибка сервера' });
        });
    }

    getStats() {
        const uptime = Math.floor(((Date.now()) - (this.bot.startTime ? this.bot.startTime.getTime() : Date.now())) / 1000);
        const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), sec = uptime % 60;
        const client = this.bot.telegramClient;
        return {
            connected: Boolean(this.bot.isRunning && client && client.connected),
            activeTriggers: this.bot.settings.triggers instanceof Map ? this.bot.settings.triggers.size : 0,
            timers: this.bot.settings.timers instanceof Map ? this.bot.settings.timers.size : 0,
            commands: Object.keys(this.bot.commands || {}).length,
            memoryMb: Math.round(process.memoryUsage().rss / 1048576),
            uptime,
            uptimeText: `${h}ч ${m}м ${sec}с`
        };
    }

    async start() {
        try {
            await new Promise((resolve, reject) => {
                this.server = this.app.listen(this.port, this.host, (err) => {
                    if (err) return reject(err);
                    console.log(`🌐 Веб-интерфейс запущен на ${this.host}:${this.port}`);
                    console.log(`🔑 Токен веб-панели: ${this.token}`);
                    console.log(`🌐 Ссылка для входа: http://${this.host}:${this.port}/?token=${this.token}`);
                    resolve();
                });
                this.server.on('error', reject);
            });

            this.startWebSocket();

            return true;
        } catch (error) {
            console.error('❌ Ошибка запуска веб-интерфейса:', error);
            return false;
        }
    }

    startWebSocket() {
        this.wss = new WebSocket.Server({
            server: this.server,
            verifyClient: (info, callback) => {
                const origin = info.origin;
                const host = info.req.headers.host;
                if (origin) {
                    try {
                        const originHost = new URL(origin).host;
                        if (originHost !== host && originHost !== `127.0.0.1:${this.port}` && originHost !== `localhost:${this.port}`) {
                            console.warn(`⛔ [SECURITY CSWSH] WebSocket отклонён: Origin ${origin} не совпадает с Host ${host}`);
                            return callback(false, 403, 'Forbidden: Invalid Origin');
                        }
                    } catch (e) {
                        return callback(false, 403, 'Forbidden: Malformed Origin');
                    }
                }
                const cookieHeader = info.req.headers.cookie || '';
                const cookieToken = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('lp_auth_token='))?.split('=')[1];
                const url = new URL(info.req.url, `http://${this.host}:${this.port}`);
                const queryToken = url.searchParams.get('token');
                const token = queryToken || cookieToken;

                if (!token || !safeCompare(token, this.token)) {
                    console.warn('⛔ [SECURITY] WebSocket отклонён: неверный или отсутствующий токен');
                    return callback(false, 401, 'Unauthorized');
                }
                callback(true);
            }
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log('🌐 Веб-интерфейс остановлен');
        }
        if (this.wss) {
            this.wss.close();
            console.log('🔌 WebSocket сервер остановлен');
        }
    }

    // Метод для отправки уведомлений через WebSocket
    broadcast(data) {
        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        }
    }
}

function safeStringify(value) {
    try { return JSON.stringify(value); } catch { return String(value); }
}

module.exports = WebInterface;
