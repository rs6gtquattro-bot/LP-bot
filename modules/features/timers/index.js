/**
 * Timers Feature Module
 * Commands: таймер, таймеры
 * Database: timers table
 * Auto-starts active timers on initialization, clears handles on stop.
 */

function parseTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        throw new Error('Неверный формат времени');
    }

    const timeUnits = {
        'с': 1,
        'сек': 1,
        's': 1,
        'м': 60,
        'мин': 60,
        'm': 60,
        'ч': 3600,
        'час': 3600,
        'h': 3600,
        'д': 86400,
        'день': 86400,
        'd': 86400,
        'н': 604800,
        'нед': 604800,
        'w': 604800,
        'мес': 2592000,
        'г': 31536000,
        'год': 31536000
    };

    const regex = /(\d+)\s*([а-яa-z]+)/gi;
    let totalSeconds = 0;
    let match;

    while ((match = regex.exec(timeStr)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        if (timeUnits[unit]) {
            totalSeconds += value * timeUnits[unit];
        } else {
            throw new Error(`Неизвестная единица времени: ${unit}`);
        }
    }

    if (totalSeconds === 0) {
        const simpleValue = parseInt(timeStr, 10);
        if (!isNaN(simpleValue)) {
            totalSeconds = simpleValue;
        } else {
            throw new Error('Неверный формат времени');
        }
    }

    if (totalSeconds <= 0) {
        throw new Error('Время должно быть положительным');
    }

    return totalSeconds;
}

function formatTime(seconds) {
    if (seconds < 60) return `${seconds} сек.`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return secs > 0 ? `${mins} мин. ${secs} сек.` : `${mins} мин.`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours} ч. ${remMins} мин.` : `${hours} ч.`;
}

function parseContext(coreOrArgs, ctxOrMessage, maybeChatId, maybeSenderId, maybeMessageId) {
    let args, message, chatId, senderId, messageId;
    if (coreOrArgs && typeof coreOrArgs.get === 'function') {
        const ctx = ctxOrMessage || {};
        args = Array.isArray(ctx.args) ? ctx.args : [];
        message = ctx.message;
        chatId = ctx.chatId;
        senderId = ctx.senderId;
        messageId = ctx.messageId;
    } else {
        args = Array.isArray(coreOrArgs) ? coreOrArgs : [];
        message = ctxOrMessage;
        chatId = maybeChatId;
        senderId = maybeSenderId;
        messageId = maybeMessageId;
    }
    return { args, message, chatId, senderId, messageId };
}

const activeTimers = new Map();

function scheduleTimer(core, timer) {
    if (!timer || !timer.name) return;
    if (activeTimers.has(timer.name)) {
        clearTimeout(activeTimers.get(timer.name));
        activeTimers.delete(timer.name);
    }

    const now = Date.now();
    const triggerTimeMs = new Date(timer.trigger_time).getTime();
    const delay = Math.max(0, triggerTimeMs - now);

    const handle = setTimeout(async () => {
        activeTimers.delete(timer.name);
        try {
            let client = null;
            try {
                const tgService = core.get('telegram');
                client = tgService ? tgService.getClient() : null;
            } catch {
                // optional
            }

            if (client && typeof client.sendMessage === 'function') {
                const text = `⏰ ТАЙМЕР "${timer.name}" СРАБОТАЛ!\n\n${timer.message_text}`;
                await client.sendMessage(timer.chat_id, { message: text });
            }

            // Удаляем или отключаем таймер после срабатывания
            const db = core.get('db');
            await db.run(`UPDATE timers SET enabled = 0, last_triggered = ? WHERE LOWER(name) = ?`, [
                new Date().toISOString(),
                timer.name.toLowerCase()
            ]);
        } catch (e) {
            core.log('timers', `Error firing timer ${timer.name}: ${e.message}`);
        }
    }, delay);

    activeTimers.set(timer.name, handle);
}

async function listTimersHandler(core, context, ...rest) {
    const { chatId, messageId } = parseContext(core, context, ...rest);
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const db = core.get('db');
    const prefix = settings.get('prefix', '.');

    const rows = await db.all(`SELECT name, trigger_time, message_text, enabled FROM timers ORDER BY created_at DESC`);
    if (!rows || rows.length === 0) {
        await messaging.editMessage(chatId, messageId, '⏰ Нет сохраненных таймеров');
        return;
    }

    let text = `⏰ СПИСОК ТАЙМЕРОВ (${rows.length}):\n\n`;
    rows.forEach((t, i) => {
        const status = t.enabled ? '🟢 Активен' : '⚪ Завершен';
        const dateStr = new Date(t.trigger_time).toLocaleString('ru-RU');
        text += `${i + 1}. "${t.name}" [${status}]\n`;
        text += `   ⏳ Время: ${dateStr}\n`;
        text += `   💬 Текст: ${t.message_text.substring(0, 30)}${t.message_text.length > 30 ? '...' : ''}\n\n`;
    });

    text += `💡 Создать таймер: ${prefix}таймер add [имя] [время] [текст]`;
    await messaging.editMessage(chatId, messageId, text);
}

module.exports = {
    name: 'timers',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db', 'messaging', 'settings'],

    parseTime,
    formatTime,

    commands: {
        'таймер': {
            aliases: [],
            help: 'Управление таймерами (add, remove, info, list)',
            async handler(core, context, ...rest) {
                const { args, message, chatId, senderId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const db = core.get('db');
                const prefix = settings.get('prefix', '.');

                if (args.length === 0) {
                    const helpText = `⏰ УПРАВЛЕНИЕ ТАЙМЕРАМИ\n\n` +
                        `• ${prefix}таймер add [имя] [время] [сообщение] - Создать таймер\n` +
                        `• ${prefix}таймер remove [имя] - Удалить таймер\n` +
                        `• ${prefix}таймер info [имя] - Информация о таймере\n` +
                        `• ${prefix}таймеры - Список таймеров\n\n` +
                        `💡 Пример: ${prefix}таймер add обед 1ч30м "Пора обедать!"`;
                    await messaging.editMessage(chatId, messageId, helpText);
                    return;
                }

                const action = args[0].toLowerCase();
                const timerName = args[1];

                try {
                    switch (action) {
                        case '+':
                        case 'add':
                        case 'адд':
                        case 'добавить': {
                            if (args.length < 3) {
                                throw new Error(`Формат: ${prefix}таймер add [название] [время] [сообщение]`);
                            }
                            const timeStr = args[2];
                            let messageText = args.slice(3).join(' ');

                            if (!messageText && message && message.replyTo && message.replyTo.replyToMsgId) {
                                messageText = message.replyTo.text || '';
                            }

                            if (!messageText) {
                                throw new Error('Укажите текст напоминания или ответьте на сообщение');
                            }

                            const seconds = parseTime(timeStr);
                            const triggerTime = new Date(Date.now() + seconds * 1000).toISOString();

                            const timerObj = {
                                name: timerName,
                                chat_id: String(chatId),
                                message_text: messageText,
                                trigger_time: triggerTime,
                                interval_seconds: seconds,
                                current_count: 0,
                                enabled: 1,
                                created_at: new Date().toISOString(),
                                last_triggered: null,
                                settings: JSON.stringify({ createdBy: senderId })
                            };

                            await db.run(
                                `INSERT INTO timers (name, chat_id, message_text, trigger_time, interval_seconds, current_count, enabled, created_at, settings)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                 ON CONFLICT(name) DO UPDATE SET trigger_time = excluded.trigger_time, message_text = excluded.message_text, enabled = 1`,
                                [timerObj.name, timerObj.chat_id, timerObj.message_text, timerObj.trigger_time, timerObj.interval_seconds, timerObj.current_count, timerObj.enabled, timerObj.created_at, timerObj.settings]
                            );

                            scheduleTimer(core, timerObj);

                            await messaging.editMessage(chatId, messageId,
                                `✅ ТАЙМЕР СОЗДАН\n\n` +
                                `🔸 Название: ${timerName}\n` +
                                `🔸 Длительность: ${formatTime(seconds)}\n` +
                                `🔸 Сработает: ${new Date(triggerTime).toLocaleString('ru-RU')}\n` +
                                `🔸 Сообщение: ${messageText}`
                            );
                            break;
                        }

                        case '-':
                        case 'remove':
                        case 'delete':
                        case 'del':
                        case 'удалить': {
                            if (!timerName) throw new Error('Укажите название таймера');
                            if (activeTimers.has(timerName)) {
                                clearTimeout(activeTimers.get(timerName));
                                activeTimers.delete(timerName);
                            }
                            await db.run(`DELETE FROM timers WHERE LOWER(name) = ?`, [timerName.toLowerCase()]);
                            await messaging.editMessage(chatId, messageId, `🗑️ Таймер "${timerName}" удален`);
                            break;
                        }

                        case 'info':
                        case 'инфо': {
                            if (!timerName) throw new Error('Укажите название таймера');
                            const row = await db.get(`SELECT * FROM timers WHERE LOWER(name) = ?`, [timerName.toLowerCase()]);
                            if (!row) throw new Error(`Таймер "${timerName}" не найден`);

                            const dateStr = new Date(row.trigger_time).toLocaleString('ru-RU');
                            const status = row.enabled ? '🟢 Активен' : '⚪ Завершен';
                            const info = `⏰ Таймер: "${row.name}"\n\n` +
                                `• Статус: ${status}\n` +
                                `• Время срабатывания: ${dateStr}\n` +
                                `• Текст: ${row.message_text}\n` +
                                `• Создан: ${row.created_at || 'неизвестно'}`;
                            await messaging.editMessage(chatId, messageId, info);
                            break;
                        }

                        case 'list':
                        case 'список': {
                            await listTimersHandler(core, context, ...rest);
                            break;
                        }

                        default:
                            await messaging.editMessage(chatId, messageId, `❌ Неизвестное действие для таймера: ${action}`);
                    }
                } catch (err) {
                    await messaging.editMessage(chatId, messageId, `❌ Ошибка: ${err.message}`);
                }
            }
        },

        'таймеры': {
            aliases: [],
            help: 'Список всех таймеров',
            handler: listTimersHandler
        }
    },

    async init(core) {
        const db = core.get('db');
        activeTimers.clear();

        // Автозапуск таймеров из БД
        try {
            const rows = await db.all(`SELECT * FROM timers WHERE enabled = 1`);
            if (rows && rows.length > 0) {
                for (const timer of rows) {
                    scheduleTimer(core, timer);
                }
            }
            core.log('timers', `Started ${activeTimers.size} active timers from database`);
        } catch (e) {
            core.log('timers', `Error initializing timers: ${e.message}`);
        }
    },

    async stop(core) {
        for (const handle of activeTimers.values()) {
            clearTimeout(handle);
        }
        activeTimers.clear();
        core.log('timers', 'Timers module stopped');
    }
};
