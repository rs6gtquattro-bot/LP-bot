let coreInstance = null;

async function executeSetFunny(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    const funnyValues = {
        uptime: '♾️ Бесконечность и дальше',
        creator: '👽 Пришелец из космоса',
        version: '🎲 Случайная версия 4.2.0',
        botName: '🤡 Бот-Приколист',
        status: '🎪 Веселюсь и радуюсь'
    };

    if (settings.data) {
        settings.data.customValues = { ...funnyValues };
    }
    if (settings.save) {
        settings.save();
    }

    const response = `🎪 УСТАНОВЛЕНЫ ПРИКОЛЬНЫЕ ЗНАЧЕНИЯ!\n\n` +
        `⏰ Аптайм: ${funnyValues.uptime}\n` +
        `👑 Создатель: ${funnyValues.creator}\n` +
        `🔧 Версия: ${funnyValues.version}\n` +
        `🤖 Имя бота: ${funnyValues.botName}\n` +
        `📱 Статус: ${funnyValues.status}\n\n` +
        `💡 Теперь команды типа ${settings.prefix}тест будут показывать эти значения!\n` +
        `😎 Чтобы сбросить: ${settings.prefix}сброс_прикола`;

    await messaging.editMessage(chatId, messageId, response);
}

module.exports = {
    name: 'funny',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'по_приколу': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeSetFunny(c, ctx);
            },
            help: 'Установить прикольные кастомные значения',
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
