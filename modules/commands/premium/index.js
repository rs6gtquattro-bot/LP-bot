const { Api } = require('telegram');

let coreInstance = null;

async function checkUserPremium(client, userId) {
    try {
        const user = await client.getEntity(userId);
        if (user.premium) return true;

        try {
            const fullUser = await client.invoke(
                new Api.users.GetFullUser({
                    id: await client.getInputEntity(userId)
                })
            );
            if (fullUser.user && fullUser.user.premium) return true;
        } catch {}

        return false;
    } catch {
        return false;
    }
}

async function executePremium(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        let targetUserId = senderId;

        if (args && args.length > 0) {
            const username = args[0].replace('@', '');
            try {
                const user = await client.getEntity(username);
                targetUserId = user.id;
            } catch {
                await messaging.editMessage(chatId, messageId, `❌ Пользователь @${username} не найден`);
                return;
            }
        } else if (message && message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await client.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });
            if (repliedMessages[0] && repliedMessages[0].senderId) {
                targetUserId = repliedMessages[0].senderId;
            }
        }

        const isPremium = await checkUserPremium(client, targetUserId);
        const user = await client.getEntity(targetUserId);

        let response = `👤 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:\n\n`;
        if (user.firstName) response += `📝 Имя: ${user.firstName}\n`;
        if (user.lastName) response += `📝 Фамилия: ${user.lastName}\n`;
        if (user.username) response += `🔗 Юзернейм: @${user.username}\n`;
        response += `🆔 ID: ${targetUserId}\n`;
        response += `💎 Telegram Premium: ${isPremium ? '✅ ДА' : '❌ НЕТ'}\n\n`;

        if (isPremium) {
            response += `🎉 Отлично! Вы можете использовать любые эмодзи в реакциях!\n`;
            response += `💡 Пример: ${settings.prefix}триггер add тест Ответ -react 🤷🏻🎉✨`;
        } else {
            response += `🔹 Доступны только базовые эмодзи для реакций\n`;
            response += `📋 Используйте ${settings.prefix}реакции для просмотра списка`;
        }

        await messaging.editMessage(chatId, messageId, response);
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка проверки Premium статуса: ${error.message}`);
    }
}

module.exports = {
    name: 'premium',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'telegram'],
    commands: {
        'премиум': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executePremium(c, ctx);
            },
            help: 'Проверка Premium статуса',
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
