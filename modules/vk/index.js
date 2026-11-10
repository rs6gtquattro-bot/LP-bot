const path = require('path');
const VkClient = require(path.join(__dirname, '..', '..', 'vk_client.js'));

/**
 * VK Client Network Module (Stage 5)
 * Name: 'vk'
 * Version: '1.0.0'
 * Requires: ['settings', 'telegram', 'db', 'utils']
 * Provides service: core.provide('vk', vkClient)
 */

function createBotAdapter(core) {
    const db = core.get('db');
    const settings = core.get('settings');
    let telegramService = null;
    try {
        telegramService = core.get('telegram');
    } catch {
        // telegram service might be mock or delayed
    }

    return {
        db: {
            run(sql, params, cb) {
                if (typeof params === 'function') {
                    cb = params;
                    params = [];
                }
                db.run(sql, params)
                    .then((res) => cb && cb(null, res))
                    .catch((err) => cb && cb(err));
            },
            get(sql, params, cb) {
                if (typeof params === 'function') {
                    cb = params;
                    params = [];
                }
                db.get(sql, params)
                    .then((row) => cb && cb(null, row))
                    .catch((err) => cb && cb(err));
            },
            all(sql, params, cb) {
                if (typeof params === 'function') {
                    cb = params;
                    params = [];
                }
                db.all(sql, params)
                    .then((rows) => cb && cb(null, rows))
                    .catch((err) => cb && cb(err));
            }
        },
        settings: {
            get prefix() {
                return settings.get('prefix', '*');
            }
        },
        get botInfo() {
            try {
                const tg = core.get('telegram');
                const client = tg && tg.getClient();
                return { id: (client && client.getMe && client.getMe().id) || 0 };
            } catch {
                return { id: 0 };
            }
        },
        get telegramClient() {
            try {
                const tg = core.get('telegram');
                return tg && tg.getClient();
            } catch {
                return null;
            }
        },
        get commands() {
            const map = {};
            for (const [cmd, entry] of core.commands) {
                map[cmd] = entry;
            }
            return map;
        },
        async handleCommand(command, args, carrier, chatId, senderId, messageId) {
            const entry = core.commands.get(command);
            if (entry && typeof entry.handler === 'function') {
                return entry.handler(core, { args, message: carrier, chatId, senderId, messageId });
            }
        }
    };
}

module.exports = {
    name: 'vk',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['settings', 'telegram', 'db', 'utils'],

    commands: {
        'вк': {
            aliases: [],
            help: 'Проброс команды в VK из Telegram (вк [команда] [аргументы])',
            async handler(core, context) {
                const { args, message, chatId, senderId, messageId } = context || {};
                const users = core.get('users');
                const messaging = core.get('messaging');
                const vkClient = core.get('vk');

                const isOwner = users.isOwnerMessage({
                    message,
                    senderId,
                    out: message ? message.out : false
                });

                if (!isOwner) {
                    await messaging.editMessage(chatId, messageId, '⛔ Команды VK из TG доступны только владельцу');
                    return;
                }

                if (!vkClient || !vkClient.running) {
                    await messaging.editMessage(chatId, messageId, '❌ VK-клиент не запущен');
                    return;
                }

                if (!args || args.length === 0) {
                    await messaging.editMessage(chatId, messageId, '💡 Использование: вк [команда] [аргументы]');
                    return;
                }

                const cmdName = args[0];
                const cmdArgs = args.slice(1);
                const res = await vkClient.runFromTg(cmdName, cmdArgs, { fromOwner: true });
                await messaging.editMessage(chatId, messageId, res);
            }
        }
    },

    async init(core) {
        const settings = core.get('settings');
        const prefix = settings.get('prefix', '*');
        const vkConfig = settings.get('vk', {}) || {};

        const token = process.env.VK_USER_TOKEN || vkConfig.userToken || vkConfig.token || '';
        const proxy = vkConfig.proxy !== undefined ? vkConfig.proxy : (process.env.VK_PROXY || '');
        const trustedIds = Array.isArray(vkConfig.trustedIds) ? vkConfig.trustedIds : [];

        const clientConfig = {
            prefix,
            proxy,
            userToken: token,
            trustedIds,
            ...vkConfig
        };

        const botAdapter = createBotAdapter(core);
        const vkClient = new VkClient(botAdapter, clientConfig, {
            log: (msg) => core.log('vk', msg)
        });

        // Предоставляем службу VK ядру
        core.provide('vk', vkClient);
        module.exports.vkClient = vkClient;

        // Мост сообщений VK -> TG через события ядра
        vkClient.onMessage = (msg) => {
            core.emit('vk_message', msg);
        };

        // Стартуем LongPoll если задан токен
        try {
            await vkClient.start();
        } catch (err) {
            core.log('vk', `VK start failed: ${err.message}`);
        }
    },

    async stop(core) {
        if (module.exports.vkClient) {
            try {
                module.exports.vkClient.stop();
                core.log('vk', 'VK client stopped');
            } catch (err) {
                core.log('vk', `VK stop error: ${err.message}`);
            }
        }
    }
};
