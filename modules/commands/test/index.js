let coreInstance = null;

async function executeTest(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const processService = core.get('process');
    const telegram = core.get('telegram');

    const custom = (settings.get && settings.get('customValues')) || {};

    const uptimeSec = processService && typeof processService.uptime === 'function'
        ? processService.uptime()
        : 0;
    const realUptime = `${uptimeSec} сек.`;
    const realCreator = '@chovamnadoa';
    const realVersion = '14.87.0';
    const realBotName = (telegram.botInfo && telegram.botInfo.firstName) || 'Бот';

    const testText = `✅ ${custom.botName || realBotName} работает!\n\n` +
        `🔧 Префикс: ${settings.prefix}\n` +
        `⏰ Аптайм: ${custom.uptime || realUptime}\n` +
        `👑 Создатель: ${custom.creator || realCreator}\n` +
        `🔧 Версия: ${custom.version || realVersion}\n` +
        `📱 Статус: ${custom.status || 'В работе'}\n\n`;

    await messaging.editMessage(chatId, messageId, testText);
}

module.exports = {
    name: 'test',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'process', 'telegram'],
    commands: {
        'тест': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeTest(c, ctx);
            },
            help: 'Тест работы бота и диагностика',
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
