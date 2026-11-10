const axios = require('axios');

let coreInstance = null;

async function executeCheckIP(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');

    try {
        const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
        await messaging.editMessage(chatId, messageId, `🌐 Ваш IP: ${response.data.ip}`);
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка получения IP: ${error.message}`);
    }
}

module.exports = {
    name: 'proxy',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging'],
    commands: {
        'прокси': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeCheckIP(c, ctx);
            },
            help: 'Показать ваш IP адрес',
            aliases: []
        }
    },
    async init(core) {
        coreInstance = core;
    },
    async stop(core) {
        coreInstance = null;
    }
};
