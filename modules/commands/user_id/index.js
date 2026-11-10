let coreInstance = null;

async function executeUserId(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        let targetUserId = senderId;

        // Если команда отправлена в ответ на другое сообщение
        if (message && message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await client.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });

            if (repliedMessages[0] && repliedMessages[0].senderId) {
                targetUserId = repliedMessages[0].senderId;
                const user = await client.getEntity(targetUserId);

                let userInfo = `👤 Информация о пользователе:\n\n`;
                if (user.firstName) userInfo += `📝 Имя: ${user.firstName}\n`;
                if (user.lastName) userInfo += `📝 Фамилия: ${user.lastName}\n`;
                if (user.username) userInfo += `🔗 Юзернейм: @${user.username}\n`;
                userInfo += `🆔 ID: ${targetUserId}\n`;

                await messaging.editMessage(chatId, messageId, userInfo);
                return;
            }
        }

        // Если указан юзернейм в аргументах
        if (args && args.length > 0) {
            const username = args[0].replace('@', '');
            try {
                const user = await client.getEntity(username);
                targetUserId = user.id;

                let userInfo = `👤 Информация о пользователе:\n\n`;
                if (user.firstName) userInfo += `📝 Имя: ${user.firstName}\n`;
                if (user.lastName) userInfo += `📝 Фамилия: ${user.lastName}\n`;
                if (user.username) userInfo += `🔗 Юзернейм: @${user.username}\n`;
                userInfo += `🆔 ID: ${targetUserId}\n`;

                await messaging.editMessage(chatId, messageId, userInfo);
                return;
            } catch {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `❌ Пользователь @${username} не найден\n\n` +
                    `💡 Проверьте:\n` +
                    `• Правильность написания юзернейма\n` +
                    `• Существует ли такой пользователь\n` +
                    `• Доступность профиля`
                );
                return;
            }
        }

        // Если нет ответа и нет аргументов - показываем ID отправителя
        const user = await client.getEntity(senderId);
        let userInfo = `👤 Ваша информация:\n\n`;
        if (user.firstName) userInfo += `📝 Имя: ${user.firstName}\n`;
        if (user.lastName) userInfo += `📝 Фамилия: ${user.lastName}\n`;
        if (user.username) userInfo += `🔗 Юзернейм: @${user.username}\n`;
        userInfo += `🆔 ID: ${senderId}\n`;

        await messaging.editMessage(chatId, messageId, userInfo);
    } catch (error) {
        await messaging.editMessage(
            chatId,
            messageId,
            `❌ Ошибка получения ID: ${error.message}\n\n` +
            `💡 Использование команды:\n` +
            `• ${settings.prefix}айди - показать ваш ID\n` +
            `• ${settings.prefix}айди @username - показать ID по юзернейму\n` +
            `• Ответьте на сообщение пользователя с командой ${settings.prefix}айди - показать его ID`
        );
    }
}

module.exports = {
    name: 'user_id',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'telegram'],
    commands: {
        'айди': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeUserId(c, ctx);
            },
            help: 'Показать ID пользователя',
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
