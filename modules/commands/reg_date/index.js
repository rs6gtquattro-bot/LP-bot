const { Api } = require('telegram');

let coreInstance = null;

async function executeRegDate(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        let targetUserId = senderId;
        let targetUser = null;

        if (message && message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await client.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });

            if (repliedMessages[0] && repliedMessages[0].senderId) {
                targetUserId = repliedMessages[0].senderId;
                targetUser = await client.getEntity(targetUserId);
            }
        } else if (args && args.length > 0) {
            const username = args[0].replace('@', '');
            try {
                targetUser = await client.getEntity(username);
                targetUserId = targetUser.id;
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

        if (!targetUser) {
            targetUser = await client.getEntity(senderId);
            targetUserId = senderId;
        }

        const isSelf = targetUserId === senderId;
        let userInfo = isSelf ? `👤 Ваша информация:\n\n` : `👤 Информация о пользователе:\n\n`;

        if (targetUser.firstName) userInfo += `📝 Имя: ${targetUser.firstName}\n`;
        if (targetUser.lastName) userInfo += `📝 Фамилия: ${targetUser.lastName}\n`;
        if (targetUser.username) userInfo += `🔗 Юзернейм: @${targetUser.username}\n`;
        userInfo += `🆔 ID: ${targetUserId}\n`;

        try {
            const fullUser = await client.invoke(
                new Api.users.GetFullUser({
                    id: await client.getInputEntity(targetUserId)
                })
            );

            if (fullUser && fullUser.user) {
                const u = fullUser.user;
                if (u.status) {
                    if (u.status.className === 'UserStatusEmpty') {
                        userInfo += `📅 Аккаунт создан: очень давно\n`;
                    } else if (u.status.className === 'UserStatusRecently') {
                        userInfo += `📅 Аккаунт создан: недавно\n`;
                    } else if (u.status.className === 'UserStatusLastWeek') {
                        userInfo += `📅 Аккаунт создан: на прошлой неделе\n`;
                    } else if (u.status.className === 'UserStatusLastMonth') {
                        userInfo += `📅 Аккаунт создан: в прошлом месяце\n`;
                    }
                }

                if (u.photo) {
                    userInfo += `🖼️ Фото профиля: есть\n`;
                }

                if (u.bot) {
                    userInfo += `🤖 Тип: Бот\n`;
                    if (fullUser.botInfo && fullUser.botInfo.description) {
                        userInfo += `📋 Описание: ${fullUser.botInfo.description}\n`;
                    }
                } else {
                    userInfo += `👤 Тип: Обычный пользователь\n`;
                }
            }
        } catch {}

        if (targetUser.status) {
            let statusInfo = '';
            if (targetUser.status.className === 'UserStatusOnline') {
                statusInfo = `🟢 В сети (онлайн)`;
            } else if (targetUser.status.className === 'UserStatusOffline') {
                const lastSeen = targetUser.status.wasOnline;
                if (lastSeen) {
                    const dateObj = new Date(lastSeen * 1000 || lastSeen);
                    statusInfo = `🔴 Был(а) в сети: ${dateObj.toLocaleDateString('ru-RU')} ${dateObj.toLocaleTimeString('ru-RU')}`;
                } else {
                    statusInfo = `🔴 Не в сети`;
                }
            } else if (targetUser.status.className === 'UserStatusRecently') {
                statusInfo = `🟡 Был(а) недавно`;
            } else if (targetUser.status.className === 'UserStatusLastWeek') {
                statusInfo = `🟡 Был(а) на прошлой неделе`;
            } else if (targetUser.status.className === 'UserStatusLastMonth') {
                statusInfo = `⚫ Был(а) в прошлом месяце`;
            } else {
                statusInfo = `❓ Статус: ${targetUser.status.className}`;
            }
            userInfo += `📱 ${statusInfo}\n`;
        }

        if (targetUser.verified) userInfo += `✅ Официально подтвержден\n`;
        if (targetUser.scam) userInfo += `⚠️ Помечен как мошенник\n`;
        if (targetUser.fake) userInfo += `🚫 Фейковый аккаунт\n`;
        if (targetUser.premium) userInfo += `💎 Telegram Premium\n`;

        userInfo += `\n💡 Примечание: Точная дата регистрации в Telegram не доступна через API.\n`;
        userInfo += `Приведенные данные основаны на статусе активности пользователя.`;

        await messaging.editMessage(chatId, messageId, userInfo);
    } catch (error) {
        await messaging.editMessage(
            chatId,
            messageId,
            `❌ Ошибка получения информации: ${error.message}\n\n` +
            `💡 Использование команды:\n` +
            `• ${settings.prefix}рег - показать вашу информацию\n` +
            `• ${settings.prefix}рег @username - показать информацию по юзернейму\n` +
            `• Ответьте на сообщение пользователя с командой ${settings.prefix}рег - показать его информацию`
        );
    }
}

module.exports = {
    name: 'reg_date',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'telegram'],
    commands: {
        'рег': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeRegDate(c, ctx);
            },
            help: 'Дата регистрации пользователя',
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
