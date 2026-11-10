const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { useWebTelegramDCs, webClientParams } = require('../../../tg_web_dc.js');

class TelegramService {
    constructor(core, options = {}) {
        this.core = core;
        this.options = options;
        this.client = null;
        this.botInfo = null;
        this.isConnected = false;
    }

    getConfig() {
        const utils = this.core.get('utils');
        const configPath = (utils.paths && utils.paths.CONFIG_PATH)
            ? utils.paths.CONFIG_PATH
            : path.resolve(__dirname, '../../../config.json');

        let fileConfig = {};
        try {
            if (fs.existsSync(configPath)) {
                fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch {}

        const apiId = process.env.TELEGRAM_API_ID || fileConfig.telegramApiId;
        const apiHash = process.env.TELEGRAM_API_HASH || fileConfig.telegramApiHash || '';
        return { apiId: apiId ? Number(apiId) : null, apiHash };
    }

    async initClient(customClient = null) {
        if (customClient) {
            this.client = customClient;
            return this.client;
        }

        const sessionService = this.core.get('session');
        const sessionString = sessionService.loadSession() || '';
        const stringSession = new StringSession(sessionString);

        const { apiId, apiHash } = this.getConfig();
        if (!apiId || !apiHash) {
            this.core.log('telegram', 'API ID или API Hash не установлены, клиент в offline-режиме');
            return null;
        }

        this.client = new TelegramClient(stringSession, apiId, apiHash, {
            ...webClientParams,
            connectionRetries: 3,
            autoReconnect: true,
            floodSleepThreshold: 60
        });

        useWebTelegramDCs(this.client);
        return this.client;
    }

    async connect() {
        if (!this.client) {
            await this.initClient();
        }
        if (!this.client) return false;

        // В headless-тестовом режиме без сети connect не блокирует процесс
        if (process.env.HEADLESS_TEST || process.env.NODE_ENV === 'test') {
            this.core.log('telegram', 'Headless test mode: пропуск сетевого подключения');
            return false;
        }

        try {
            await this.client.connect();
            const sessionService = this.core.get('session');
            if (await this.client.checkAuthorization()) {
                this.botInfo = await this.client.getMe();
                this.isConnected = true;
                const newSession = this.client.session.save();
                sessionService.saveSession(newSession);
                this.core.log('telegram', `Авторизован как @${this.botInfo.username || this.botInfo.id}`);
                this.setupEventHandlers();
                return true;
            } else {
                this.core.log('telegram', 'Сессия не авторизована, требуется консольный вход');
                return false;
            }
        } catch (e) {
            this.core.log('telegram', `Ошибка подключения: ${e.message}`);
            return false;
        }
    }

    setupEventHandlers() {
        if (!this.client) return;

        this.client.addEventHandler(async (event) => {
            const message = event.message;
            if (!message || !message.text) return;

            const settings = this.core.get('settings');
            const prefix = settings ? settings.prefix : '!';

            const senderId = message.senderId || (message.fromId ? message.fromId.userId : null);
            const chatId = message.peerId;

            const ctx = {
                platform: 'telegram',
                message,
                chatId,
                senderId,
                messageId: message.id,
                text: message.text,
                out: Boolean(message.out),
                prefix
            };

            await this.core.emit('message', ctx);
        }, new NewMessage({}));
    }

    async disconnect() {
        if (this.client) {
            try {
                await this.client.disconnect();
            } catch {}
            this.isConnected = false;
        }
    }
}

module.exports = {
    name: 'telegram',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['settings', 'session', 'utils'],

    async init(core) {
        const service = new TelegramService(core);
        core.provide('telegram', service);
        core.log('telegram', 'Служба telegram инициализирована');
    },

    async stop(core) {
        try {
            const service = core.get('telegram');
            if (service && typeof service.disconnect === 'function') {
                await service.disconnect();
            }
        } catch {}
    }
};
