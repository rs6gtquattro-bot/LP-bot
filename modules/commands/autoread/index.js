let coreInstance = null;

async function executeToggleAutoRead(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    const current = Boolean(settings.get && settings.get('autoReadMentions', false));
    const next = !current;

    if (settings.set) {
        settings.set('autoReadMentions', next);
    } else {
        settings.data.autoReadMentions = next;
        if (settings.save) settings.save();
    }

    const status = next ? 'ВКЛЮЧЕНО ✅' : 'ВЫКЛЮЧЕНО ❌';
    const description = next
        ? 'Теперь все упоминания бота будут автоматически прочитываться'
        : 'Автопрочитывание упоминаний отключено';

    const response = `👀 Автопрочитывание упоминаний: ${status}\n\n${description}\n\n💾 Настройка сохранена`;
    await messaging.editMessage(chatId, messageId, response);
}

module.exports = {
    name: 'autoread',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'автопуши': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeToggleAutoRead(c, ctx);
            },
            help: 'Автопрочитывание упоминаний',
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
