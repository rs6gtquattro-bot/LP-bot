let coreInstance = null;

async function executeChatInfo(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const telegram = core.get('telegram');

    try {
        if (!telegram.client) {
            throw new Error('Telegram клиент не подключен');
        }

        const chat = await telegram.client.getEntity(chatId);
        let info = `💬 Информация о чате:\n\n`;

        if (chat.title) info += `📝 Название: ${chat.title}\n`;
        if (chat.username) info += `🔗 Юзернейм: @${chat.username}\n`;
        info += `🆔 ID: ${chat.id}\n`;
        info += `📊 Тип: ${chat.className}\n`;

        if (chat.participantsCount) {
            info += `👥 Участников: ${chat.participantsCount}\n`;
        }

        await messaging.editMessage(chatId, messageId, info);
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка получения информации: ${error.message}`);
    }
}

module.exports = {
    name: 'chat_info',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram'],
    commands: {
        'о_чате': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeChatInfo(c, ctx);
            },
            help: 'Информация о текущем чате',
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
