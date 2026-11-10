let coreInstance = null;

async function executeResetFunny(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    if (settings.data) {
        settings.data.customValues = {
            uptime: null,
            creator: null,
            version: null,
            botName: null,
            status: null
        };
    }
    if (settings.save) {
        settings.save();
    }

    await messaging.editMessage(
        chatId,
        messageId,
        `🔄 Все кастомные значения сброшены!\n` +
        `📊 Теперь отображаются реальные данные бота.`
    );
}

module.exports = {
    name: 'funny_reset',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'сброс_прикола': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeResetFunny(c, ctx);
            },
            help: 'Сбросить все кастомные значения бота',
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
