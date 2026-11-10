const { Api } = require('telegram');

let coreInstance = null;

async function executeTogglePin(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        if (message && message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessageId = message.replyTo.replyToMsgId;
            const peer = await client.getInputEntity(chatId);

            try {
                await client.invoke(
                    new Api.messages.UpdatePinnedMessage({
                        peer,
                        id: repliedMessageId,
                        unpin: false,
                        pmOneSide: false
                    })
                );
                await messaging.editMessage(chatId, messageId, `📌 Сообщение закреплено`);
            } catch {
                try {
                    await client.invoke(
                        new Api.messages.UpdatePinnedMessage({
                            peer,
                            id: repliedMessageId,
                            unpin: true,
                            pmOneSide: false
                        })
                    );
                    await messaging.editMessage(chatId, messageId, `📌 Сообщение откреплено`);
                } catch (unpinError) {
                    throw new Error(`Не удалось закрепить или открепить: ${unpinError.message}`);
                }
            }
        } else {
            const peer = await client.getInputEntity(chatId);
            await client.invoke(
                new Api.messages.UnpinAllMessages({ peer })
            );
            await messaging.editMessage(chatId, messageId, `📌 Все сообщения откреплены`);
        }
    } catch (error) {
        let errorMessage = `❌ Ошибка: ${error.message}`;
        if (error.message.includes('CHAT_NOT_MODIFIED')) {
            errorMessage = `❌ Сообщение уже имеет нужный статус`;
        } else if (error.message.includes('CHAT_ADMIN_REQUIRED')) {
            errorMessage = `❌ Требуются права администратора`;
        } else if (error.message.includes('MESSAGE_ID_INVALID')) {
            errorMessage = `❌ Сообщение не найдено`;
        } else if (error.message.includes('CHAT_ID_INVALID')) {
            errorMessage = `❌ Неверный ID чата`;
        }
        await messaging.editMessage(chatId, messageId, errorMessage);
    }
}

module.exports = {
    name: 'pin',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram'],
    commands: {
        'закреп': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeTogglePin(c, ctx);
            },
            help: 'Закрепить/открепить сообщение',
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
