const axios = require('axios');

let coreInstance = null;

async function executeCheckURL(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    if (!args || args.length === 0) {
        await messaging.editMessage(chatId, messageId, `🌐 Использование: ${settings.prefix}проверить [url]`);
        return;
    }

    let url = args[0];

    try {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        try {
            new URL(url);
        } catch {
            await messaging.editMessage(chatId, messageId, `❌ Неверный формат URL: ${url}`);
            return;
        }

        const response = await axios.head(url, {
            timeout: 10000,
            validateStatus: (status) => status >= 200 && status < 600
        });

        let statusText = '';
        if (response.status >= 200 && response.status < 300) {
            statusText = '✅ Доступен';
        } else if (response.status >= 300 && response.status < 400) {
            statusText = '🔄 Перенаправление';
        } else if (response.status >= 400 && response.status < 500) {
            statusText = '❌ Ошибка клиента';
        } else if (response.status >= 500) {
            statusText = '🚫 Ошибка сервера';
        }

        await messaging.editMessage(
            chatId,
            messageId,
            `${statusText}\n` +
            `📊 Статус: ${response.status} ${response.statusText || ''}\n` +
            `🔗 URL: ${url}\n` +
            `⏱️  Время ответа: ${response.duration ? Math.round(response.duration) + 'ms' : 'N/A'}`
        );
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            try {
                const getResponse = await axios.get(url, {
                    timeout: 10000,
                    validateStatus: null
                });

                let getStatusText = '';
                if (getResponse.status >= 200 && getResponse.status < 300) {
                    getStatusText = '✅ Доступен (GET)';
                } else {
                    getStatusText = `⚠️ Ответ получен (${getResponse.status})`;
                }

                await messaging.editMessage(
                    chatId,
                    messageId,
                    `${getStatusText}\n` +
                    `📊 Статус: ${getResponse.status}\n` +
                    `🔗 URL: ${url}\n` +
                    `💡 Метод: GET (HEAD не поддерживается)`
                );
            } catch (getError) {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `❌ Сайт недоступен: ${url}\n\n` +
                    `🔍 Детали ошибки:\n` +
                    `• ${getError.message}\n` +
                    `• ${getError.code || 'Неизвестная ошибка'}\n\n` +
                    `💡 Проверьте:\n` +
                    `• Правильность написания адреса\n` +
                    `• Подключение к интернету\n` +
                    `• Доступность сайта`
                );
            }
        } else {
            await messaging.editMessage(
                chatId,
                messageId,
                `❌ Ошибка проверки: ${url}\n\n` +
                `📝 ${error.message}\n` +
                `🔧 ${error.code || 'Неизвестная ошибка'}`
            );
        }
    }
}

module.exports = {
    name: 'check_url',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'проверить': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeCheckURL(c, ctx);
            },
            help: 'Проверка доступности ссылки',
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
