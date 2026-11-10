let coreInstance = null;

async function executeChangePrefix(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    if (!args || args.length === 0) {
        await messaging.editMessage(chatId, messageId, `📝 Использование: ${settings.prefix}префикс [новый_префикс]`);
        return;
    }

    const newPrefix = args[0];
    try {
        if (typeof settings.setPrefix === 'function') {
            settings.setPrefix(newPrefix);
        } else {
            settings.set('prefix', newPrefix);
        }

        await messaging.editMessage(chatId, messageId, `✅ Префикс изменен на: ${newPrefix}`);
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка изменения префикса: ${error.message}`);
    }
}

module.exports = {
    name: 'prefix',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'префикс': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeChangePrefix(c, ctx);
            },
            help: 'Смена префикса команд',
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
