const { Api } = require('telegram');

let coreInstance = null;

async function executeReadMessages(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        await messaging.editMessage(chatId, messageId, `🔍 Начинаю прочитывать все чаты...`);

        const dialogs = await client.getDialogs({});
        let readCount = 0;
        let errorCount = 0;
        let skippedCount = 0;

        for (const dialog of dialogs) {
            try {
                if (dialog.archived || dialog.unreadCount === 0) {
                    skippedCount++;
                    continue;
                }

                const entity = dialog.entity;
                let peer;
                if (entity.className === 'Channel' || entity.className === 'Chat' || entity.className === 'User') {
                    peer = await client.getInputEntity(entity);
                } else {
                    peer = entity;
                }

                if (entity.className === 'Channel') {
                    try {
                        await client.invoke(
                            new Api.channels.ReadHistory({
                                channel: peer,
                                maxId: 0
                            })
                        );
                        readCount++;
                    } catch {
                        errorCount++;
                    }
                } else {
                    try {
                        await client.invoke(
                            new Api.messages.ReadHistory({
                                peer: peer,
                                maxId: 0
                            })
                        );
                        readCount++;
                    } catch {
                        errorCount++;
                    }
                }

                try {
                    await client.invoke(
                        new Api.messages.ReadMentions({
                            peer: peer
                        })
                    );
                } catch {}

                if ((readCount + errorCount) % 5 === 0) {
                    await messaging.editMessage(
                        chatId,
                        messageId,
                        `📖 Прогресс: ${readCount + errorCount + skippedCount}/${dialogs.length}\n` +
                        `✅ Прочитано: ${readCount}\n` +
                        `❌ Ошибок: ${errorCount}\n` +
                        `⏭️  Пропущено: ${skippedCount}\n` +
                        `⏳ Продолжаю...`
                    );
                }

                await new Promise((resolve) => setTimeout(resolve, 200));
            } catch {
                errorCount++;
                continue;
            }
        }

        const resultMessage = `✅ Прочтение завершено!\n\n` +
            `📊 Результаты:\n` +
            `• Всего диалогов: ${dialogs.length}\n` +
            `• Успешно прочитано: ${readCount}\n` +
            `• Ошибок: ${errorCount}\n` +
            `• Пропущено: ${skippedCount}\n\n` +
            `💡 Все доступные непрочитанные сообщения отмечены как прочитанные.`;

        await messaging.editMessage(chatId, messageId, resultMessage);
    } catch (error) {
        await messaging.editMessage(
            chatId,
            messageId,
            `❌ Ошибка выполнения команды: ${error.message}\n\n` +
            `💡 Возможные причины:\n` +
            `• Проблемы с подключением\n` +
            `• Ограничения Telegram API\n` +
            `• Попробуйте позже`
        );
    }
}

module.exports = {
    name: 'read',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram'],
    commands: {
        'прочитать': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeReadMessages(c, ctx);
            },
            help: 'Прочитать все непрочитанные сообщения',
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
