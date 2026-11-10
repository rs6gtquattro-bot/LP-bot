let coreInstance = null;

async function executeSearch(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    if (!args || args.length === 0) {
        await messaging.editMessage(chatId, messageId, `🔍 Использование: ${settings.prefix}поиск [запрос]`);
        return;
    }

    const query = args.join(' ');
    const searchUrl = `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;

    await messaging.editMessage(chatId, messageId, `🔍 Результаты поиска для "${query}":\n${searchUrl}`);
}

module.exports = {
    name: 'search',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'поиск': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeSearch(c, ctx);
            },
            help: 'Поиск в Yandex',
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
