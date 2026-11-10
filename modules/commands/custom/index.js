let coreInstance = null;

async function executeCustom(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    const customValues = (settings.data && settings.data.customValues) || (settings.get && settings.get('customValues')) || {};

    if (!args || args.length < 2) {
        const response = `🎭 КАСТОМНЫЕ ЗНАЧЕНИЯ БОТА\n\n` +
            `⏰ Аптайм: ${customValues.uptime || 'не установлен'}\n` +
            `👑 Создатель: ${customValues.creator || 'не установлен'}\n` +
            `🔧 Версия: ${customValues.version || 'не установлен'}\n` +
            `🤖 Имя бота: ${customValues.botName || 'не установлено'}\n` +
            `📱 Статус: ${customValues.status || 'не установлен'}\n\n` +
            `💡 Команды:\n` +
            `• ${settings.prefix}кастом аптайм [текст] - установить кастомный аптайм\n` +
            `• ${settings.prefix}кастом создатель [текст] - установить создателя\n` +
            `• ${settings.prefix}кастом версия [текст] - установить версию\n` +
            `• ${settings.prefix}кастом имя [текст] - установить имя бота\n` +
            `• ${settings.prefix}кастом статус [текст] - установить статус\n` +
            `• ${settings.prefix}сброс_прикола - сбросить все значения\n` +
            `• ${settings.prefix}по_приколу - установить прикольные значения`;

        await messaging.editMessage(chatId, messageId, response);
        return;
    }

    const action = args[0].toLowerCase();
    const value = args.slice(1).join(' ');

    try {
        switch (action) {
            case 'аптайм':
            case 'uptime':
                customValues.uptime = value;
                await messaging.editMessage(chatId, messageId, `✅ Кастомный аптайм установлен!\n📝 Теперь будет отображаться: "${value}"`);
                break;
            case 'создатель':
            case 'creator':
                customValues.creator = value;
                await messaging.editMessage(chatId, messageId, `✅ Кастомный создатель установлен!\n👑 Теперь создатель: "${value}"`);
                break;
            case 'версия':
            case 'version':
                customValues.version = value;
                await messaging.editMessage(chatId, messageId, `✅ Кастомная версия установлена!\n🔧 Теперь версия: "${value}"`);
                break;
            case 'имя':
            case 'name':
            case 'botname':
                customValues.botName = value;
                await messaging.editMessage(chatId, messageId, `✅ Кастомное имя бота установлено!\n🤖 Теперь бот называется: "${value}"`);
                break;
            case 'статус':
            case 'status':
                customValues.status = value;
                await messaging.editMessage(chatId, messageId, `✅ Кастомный статус установлен!\n📱 Теперь статус: "${value}"`);
                break;
            default:
                await messaging.editMessage(chatId, messageId, `❌ Неизвестное действие. Используйте: аптайм, создатель, версия, имя, статус`);
                return;
        }

        if (settings.data) settings.data.customValues = customValues;
        if (settings.save) settings.save();
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
    }
}

module.exports = {
    name: 'custom',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'кастом': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeCustom(c, ctx);
            },
            help: 'Настройка кастомных значений бота',
            aliases: ['custom']
        }
    },
    async init(core) {
        coreInstance = core;
    },
    async stop(core) {
        coreInstance = null;
    }
};
