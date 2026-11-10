const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
let coreInstance = null;

async function executeShowCommands(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const processService = core.get('process');

    const custom = (settings.get && settings.get('customValues')) || {};
    const realCreator = '@chovamnadoa';
    const realVersion = '3.0.0';

    const categories = {
        '🔔 УВЕДОМЛЕНИЯ И СТАТУСЫ': [
            { command: 'уведы', description: 'Включить/выключить уведомления' },
        ],
        '🛡️ БЕЗОПАСНОСТЬ И МОДЕРАЦИЯ': [
            { command: 'автопуши', description: 'Автопрочитывание упоминаний' },
        ],
        '📱 УТИЛИТЫ И ИНСТРУМЕНТЫ': [
            { command: 'qr [текст]', description: 'Генерация QR-кода' },
            { command: 'чек_qr', description: 'Сканирование QR-кода (ответом на фото)' },
            { command: 'проверить [url]', description: 'Проверка доступности ссылки' },
            { command: 'прокси', description: 'Показать ваш IP адрес' },
            { command: 'перевод [текст]', description: 'Перевод текста на русский' },
            { command: 'поиск [запрос]', description: 'Поиск в Yandex' },
            { command: 'префикс [символ]', description: 'Смена префикса команд' }
        ],
        '👥 РАБОТА С ЧАТАМИ': [
            { command: 'о_чате', description: 'Информация о текущем чате' },
            { command: 'айди [юзернейм]', description: 'Показать ID пользователя' },
            { command: 'рег [юзернейм]', description: 'Дата регистрации пользователя' },
            { command: 'кража_авы [юзернейм]', description: 'Скопировать аватар пользователя' },
            { command: 'прочитать', description: 'Прочитать последние сообщения' },
        ],
        '💬 УПРАВЛЕНИЕ СООБЩЕНИЯМИ': [
            { command: 'смс [кол-во]', description: 'Удалить сообщения (ответом на сообщение или по количеству)' },
            { command: 'закреп', description: 'Закрепить сообщение (ответом)' }
        ],
        '🎯 ТРИГГЕРЫ И АВТОМАТИЗАЦИЯ': [
            { command: 'триггер add [слово] [ответы]', description: 'Добавить триггер с настройками' },
            { command: 'триггер remove [слово]', description: 'Удалить триггер' },
            { command: 'триггер edit [слово] [ответы]', description: 'Изменить ответы триггера' },
            { command: 'триггер info [слово]', description: 'Подробная информация о триггере' },
            { command: 'триггер list', description: 'Посмотреть все возможности триггеров' }
        ],
        '📁 ШАБЛОНЫ СООБЩЕНИЙ': [
            { command: 'шаб + [название]', description: 'Сохранить шаблон (ответом на сообщение)' },
            { command: 'шаб [название]', description: 'Использовать шаблон' },
            { command: 'шаб - [название]', description: 'Удалить шаблон' },
            { command: 'шаб info [название]', description: 'Информация о шаблоне' },
            { command: 'шаблоны', description: 'Список всех шаблонов' }
        ],
        '🤖 ЛОКАЛЬНЫЙ DEEPCHAT': [
            { command: 'дип [запрос]', description: 'AI ассистент DeepSeek' },
            { command: 'дип_ключ [api_key]', description: 'Установить API ключ DeepSeek' },
            { command: 'дип_статус', description: 'Статус DeepSeek' },
            { command: 'дип_помощь', description: 'Помощь по DeepSeek' }
        ],
        '📊 СТАТИСТИКА И МОНИТОРИНГ': [
            { command: 'тест', description: 'Тест работы бота и диагностика' }
        ]
    };

    const totalCmds = core.commands ? core.commands.size : 38;
    const uptimeSec = processService && typeof processService.uptime === 'function'
        ? processService.uptime()
        : 0;

    let triggersCount = 0;
    try {
        const db = core.get('db');
        if (db && typeof db.get === 'function') {
            const row = await db.get('SELECT COUNT(*) as cnt FROM triggers');
            triggersCount = row ? row.cnt : 0;
        }
    } catch {}

    const prefix = settings.prefix || '!';

    let response = `🤖 LP-BOT [TG] — СПИСОК КОМАНД 🤖\n`;
    response += `${DIVIDER}\n`;
    response += `📋 Префикс команд: ${prefix}\n`;
    response += `🔢 Всего команд: ${totalCmds}\n`;
    response += `🎯 Триггеров: ${triggersCount}\n`;
    response += `⏰ Аптайм: ${uptimeSec} сек.\n`;
    response += `${DIVIDER}\n\n`;

    for (const [category, commands] of Object.entries(categories)) {
        response += `${category}:\n`;
        commands.forEach((cmd) => {
            response += `   🔹 ${prefix}${cmd.command} — ${cmd.description}\n`;
        });
        response += `\n`;
    }

    response += `${DIVIDER}\n`;
    response += `⚡ Версия: ${custom.version || realVersion} | 🔧 Разработчик: ${custom.creator || realCreator}\n`;

    if (custom.uptime || custom.botName || custom.status) {
        response += `🎭 Кастомные настройки: `;
        const customParts = [];
        if (custom.botName) customParts.push(`Имя: ${custom.botName}`);
        if (custom.status) customParts.push(`Статус: ${custom.status}`);
        if (custom.uptime) customParts.push(`Аптайм: ${custom.uptime}`);
        response += customParts.join(' • ') + '\n';
    }

    response += `💡 Используйте ответы на сообщения для некоторых команд!\n\n`;
    response += `🎪 Прикольные команды:\n`;
    response += `• ${prefix}кастом — Настроить кастомные значения\n`;
    response += `• ${prefix}по_приколу — Установить прикольные значения\n`;
    response += `• ${prefix}сброс_прикола — Сбросить кастомные значения`;

    await messaging.editMessage(chatId, messageId, response);
}

module.exports = {
    name: 'commands_list',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'process'],
    commands: {
        'команды': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeShowCommands(c, ctx);
            },
            help: 'Список всех команд',
            aliases: ['хелп', 'кмд', 'help']
        }
    },
    async init(core) {
        coreInstance = core;
    },
    async stop(core) {
        coreInstance = null;
    }
};
