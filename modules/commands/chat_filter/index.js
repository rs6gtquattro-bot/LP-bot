let coreInstance = null;

async function executeChatBlacklist(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const users = core.get('users');
    const settings = core.get('settings');
    const prefix = (settings && settings.prefix) || '!';

    const action = args && args[0] ? args[0].toLowerCase() : 'список';
    const targetChatId = args && args[1] ? args[1] : chatId;

    try {
        switch (action) {
            case 'добавить':
            case '+': {
                const addedId = await users.addBlacklistChat(targetChatId);
                await messaging.editMessage(chatId, messageId, `🔇 Чат ${addedId} добавлен в черный список.\nКоманды и триггеры в нем полностью заглушены.`);
                break;
            }
            case 'удалить':
            case '-':
            case 'del': {
                const removed = await users.removeBlacklistChat(targetChatId);
                if (removed) {
                    await messaging.editMessage(chatId, messageId, `🔊 Чат ${targetChatId} удален из черного списка.`);
                } else {
                    await messaging.editMessage(chatId, messageId, `⚠️ Чат ${targetChatId} не найден в черном списке.`);
                }
                break;
            }
            case 'очистить':
            case 'clear': {
                await users.clearBlacklistChats();
                await messaging.editMessage(chatId, messageId, '🧹 Черный список чатов полностью очищен.');
                break;
            }
            case 'список':
            case 'list':
            default: {
                const list = users.getBlacklistChats();
                if (list.length === 0) {
                    await messaging.editMessage(chatId, messageId, `📋 Черный список чатов пуст.\nДобавить: ${prefix}чс_чат добавить [id]`);
                } else {
                    const lines = list.map((id, idx) => `${idx + 1}. \`${id}\``).join('\n');
                    await messaging.editMessage(chatId, messageId, `🔇 Заглушенные чаты (${list.length}):\n\n${lines}\n\nУдалить: ${prefix}чс_чат удалить [id]`);
                }
                break;
            }
        }
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка управления ЧС чатов: ${error.message}`);
    }
}

async function executeChatWhitelist(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const users = core.get('users');
    const settings = core.get('settings');
    const prefix = (settings && settings.prefix) || '!';

    const action = args && args[0] ? args[0].toLowerCase() : 'список';
    const targetChatId = args && args[1] ? args[1] : chatId;

    try {
        switch (action) {
            case 'добавить':
            case '+': {
                const addedId = await users.addWhitelistChat(targetChatId);
                await messaging.editMessage(chatId, messageId, `⚪ Чат ${addedId} добавлен в белый список.\nРежим Strict Whitelist активен.`);
                break;
            }
            case 'удалить':
            case '-':
            case 'del': {
                const removed = await users.removeWhitelistChat(targetChatId);
                if (removed) {
                    await messaging.editMessage(chatId, messageId, `⚪ Чат ${targetChatId} удален из белого списка.`);
                } else {
                    await messaging.editMessage(chatId, messageId, `⚠️ Чат ${targetChatId} не найден в белом списке.`);
                }
                break;
            }
            case 'очистить':
            case 'clear': {
                await users.clearWhitelistChats();
                await messaging.editMessage(chatId, messageId, '🧹 Белый список чатов очищен (фильтрация по белому списку отключена).');
                break;
            }
            case 'список':
            case 'list':
            default: {
                const list = users.getWhitelistChats();
                if (list.length === 0) {
                    await messaging.editMessage(chatId, messageId, `📋 Белый список чатов пуст (бот отвечает везде, кроме ЧС).\nАктивировать: ${prefix}бс_чат добавить [id]`);
                } else {
                    const lines = list.map((id, idx) => `${idx + 1}. \`${id}\``).join('\n');
                    await messaging.editMessage(chatId, messageId, `⚪ Разрешенные чаты (Strict Whitelist, ${list.length}):\n\n${lines}\n\nУдалить: ${prefix}бс_чат удалить [id]`);
                }
                break;
            }
        }
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка управления БС чатов: ${error.message}`);
    }
}

module.exports = {
    name: 'chat_filter',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'users', 'settings'],
    commands: {
        'чс_чат': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeChatBlacklist(c, ctx);
            },
            help: 'Черный список чатов: чс_чат [добавить|удалить|список|очистить]',
            aliases: []
        },
        'бс_чат': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeChatWhitelist(c, ctx);
            },
            help: 'Белый список чатов: бс_чат [добавить|удалить|список|очистить]',
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
