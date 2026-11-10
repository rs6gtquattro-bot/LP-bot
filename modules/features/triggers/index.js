/**
 * Triggers Feature Module
 * Commands: триггер, триггеры, debug_triggers
 * Message bus listener: core.on('message')
 */

function parseClock(timeStr) {
    const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(timeStr ?? ''));
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function checkTriggerConditions(trigger, userId, chatId) {
    const settings = trigger.settings || {};

    if (settings.allowedChats && settings.allowedChats.length > 0 &&
        !settings.allowedChats.map(String).includes(String(chatId))) {
        return false;
    }

    if (settings.excludedChats && settings.excludedChats.length > 0 &&
        settings.excludedChats.map(String).includes(String(chatId))) {
        return false;
    }

    if (settings.allowedUsers && settings.allowedUsers.length > 0 &&
        !settings.allowedUsers.map(String).includes(String(userId))) {
        return false;
    }

    if (settings.excludedUsers && settings.excludedUsers.length > 0 &&
        settings.excludedUsers.map(String).includes(String(userId))) {
        return false;
    }

    if (settings.timeStart && settings.timeEnd) {
        const startTime = parseClock(settings.timeStart);
        const endTime = parseClock(settings.timeEnd);
        if (startTime !== null && endTime !== null) {
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            if (startTime > endTime) {
                if (!(currentTime >= startTime || currentTime <= endTime)) {
                    return false;
                }
            } else if (!(currentTime >= startTime && currentTime <= endTime)) {
                return false;
            }
        }
    }

    if (Array.isArray(settings.days) && settings.days.length > 0) {
        const currentDay = new Date().getDay();
        const adjustedDay = currentDay === 0 ? 7 : currentDay;
        if (!settings.days.map(Number).includes(adjustedDay)) {
            return false;
        }
    }

    return true;
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

module.exports = {
    name: 'triggers',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db', 'messaging', 'settings', 'utils'],

    triggersMap: new Map(),

    commands: {
        'триггер': {
            aliases: [],
            help: 'Управление триггерами (add, remove, info, enable, disable, list)',
            async handler(core, context, ...rest) {
                const { args, chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const db = core.get('db');
                const prefix = settings.get('prefix', '.');
                const triggers = module.exports.triggersMap;

                if (args.length < 1) {
                    const helpText = `🔔 УПРАВЛЕНИЕ ТРИГГЕРАМИ\n\n` +
                        `• ${prefix}триггер add [слово] [ответ] - Создать триггер\n` +
                        `• ${prefix}триггер remove [слово] - Удалить триггер\n` +
                        `• ${prefix}триггер info [слово] - Информация о триггере\n` +
                        `• ${prefix}триггер enable [слово] - Включить\n` +
                        `• ${prefix}триггер disable [слово] - Выключить\n` +
                        `• ${prefix}триггеры - Список всех триггеров`;
                    await messaging.editMessage(chatId, messageId, helpText);
                    return;
                }

                const action = args[0].toLowerCase();
                const word = args[1] ? args[1].toLowerCase() : null;

                try {
                    switch (action) {
                        case 'add':
                        case 'добавить': {
                            if (!word || args.length < 3) {
                                throw new Error(`Формат: ${prefix}триггер add [слово] [ответ]`);
                            }
                            const responseText = args.slice(2).join(' ');
                            const responses = [responseText];
                            const triggerSettings = {
                                enabled: true,
                                cooldown: 0,
                                chance: 100,
                                regex: false,
                                caseSensitive: false,
                                priority: 1,
                                allowedChats: [],
                                excludedChats: [],
                                allowedUsers: [],
                                excludedUsers: [],
                                timeStart: null,
                                timeEnd: null,
                                days: []
                            };

                            const triggerObj = {
                                word,
                                responses,
                                settings: triggerSettings,
                                used_count: 0,
                                last_used: null,
                                created_at: new Date().toISOString()
                            };

                            await db.run(
                                `INSERT INTO triggers (word, responses, settings, used_count, created_at)
                                 VALUES (?, ?, ?, ?, ?)
                                 ON CONFLICT(word) DO UPDATE SET responses = excluded.responses, settings = excluded.settings`,
                                [word, JSON.stringify(responses), JSON.stringify(triggerSettings), 0, triggerObj.created_at]
                            );

                            triggers.set(word, triggerObj);
                            await messaging.editMessage(chatId, messageId, `✅ Триггер "${word}" успешно сохранен!`);
                            break;
                        }

                        case 'remove':
                        case 'delete':
                        case 'del':
                        case 'удалить': {
                            if (!word) throw new Error('Укажите слово триггера для удаления');
                            await db.run(`DELETE FROM triggers WHERE LOWER(word) = ?`, [word]);
                            triggers.delete(word);
                            await messaging.editMessage(chatId, messageId, `🗑️ Триггер "${word}" удален`);
                            break;
                        }

                        case 'info':
                        case 'инфо': {
                            if (!word) throw new Error('Укажите слово триггера');
                            const tr = triggers.get(word);
                            if (!tr) throw new Error(`Триггер "${word}" не найден`);
                            const info = `🔔 Триггер: "${tr.word}"\n\n` +
                                `• Статус: ${tr.settings.enabled ? '✅ Активен' : '❌ Выключен'}\n` +
                                `• Использований: ${tr.used_count || 0}\n` +
                                `• Ответов: ${tr.responses.length}\n` +
                                `• Шанс: ${tr.settings.chance || 100}%\n` +
                                `• Создан: ${tr.created_at || 'неизвестно'}`;
                            await messaging.editMessage(chatId, messageId, info);
                            break;
                        }

                        case 'enable':
                        case 'включить': {
                            if (!word) throw new Error('Укажите слово триггера');
                            const tr = triggers.get(word);
                            if (!tr) throw new Error(`Триггер "${word}" не найден`);
                            tr.settings.enabled = true;
                            await db.run(`UPDATE triggers SET settings = ? WHERE LOWER(word) = ?`, [JSON.stringify(tr.settings), word]);
                            await messaging.editMessage(chatId, messageId, `✅ Триггер "${word}" включен`);
                            break;
                        }

                        case 'disable':
                        case 'выключить': {
                            if (!word) throw new Error('Укажите слово триггера');
                            const tr = triggers.get(word);
                            if (!tr) throw new Error(`Триггер "${word}" не найден`);
                            tr.settings.enabled = false;
                            await db.run(`UPDATE triggers SET settings = ? WHERE LOWER(word) = ?`, [JSON.stringify(tr.settings), word]);
                            await messaging.editMessage(chatId, messageId, `⏸️ Триггер "${word}" выключен`);
                            break;
                        }

                        default:
                            await messaging.editMessage(chatId, messageId, `❌ Неизвестное действие: ${action}`);
                    }
                } catch (err) {
                    await messaging.editMessage(chatId, messageId, `❌ Ошибка: ${err.message}`);
                }
            }
        },

        'триггеры': {
            aliases: [],
            help: 'Список всех сохраненных триггеров',
            async handler(core, context, ...rest) {
                const { chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const triggers = module.exports.triggersMap;

                if (triggers.size === 0) {
                    await messaging.editMessage(chatId, messageId, '🔔 Список триггеров пуст');
                    return;
                }

                let text = `🔔 СПИСОК ТРИГГЕРОВ (${triggers.size}):\n\n`;
                let idx = 1;
                for (const [w, tr] of triggers) {
                    const status = tr.settings && tr.settings.enabled ? '🟢' : '🔴';
                    text += `${idx++}. ${status} "${w}" (срабатываний: ${tr.used_count || 0})\n`;
                }
                await messaging.editMessage(chatId, messageId, text);
            }
        },

        'debug_triggers': {
            aliases: [],
            help: 'Отладочная информация о триггерах',
            async handler(core, context, ...rest) {
                const { chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const triggers = module.exports.triggersMap;

                const activeCount = [...triggers.values()].filter(t => t.settings && t.settings.enabled).length;
                const totalCount = triggers.size;

                const debugText = `🔍 ДИАГНОСТИКА ТРИГГЕРОВ\n\n` +
                    `• Всего в памяти: ${totalCount}\n` +
                    `• Активных: ${activeCount}\n` +
                    `• Шина сообщений: core.on('message') подключена\n` +
                    `• Движок: 1.0.0`;

                await messaging.editMessage(chatId, messageId, debugText);
            }
        }
    },

    async init(core) {
        const db = core.get('db');
        const triggers = module.exports.triggersMap;
        triggers.clear();

        // Загрузка триггеров из БД
        try {
            const rows = await db.all(`SELECT word, responses, settings, used_count, last_used, created_at FROM triggers`);
            if (rows && rows.length > 0) {
                for (const row of rows) {
                    try {
                        const responses = typeof row.responses === 'string' ? JSON.parse(row.responses) : row.responses;
                        const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
                        triggers.set(String(row.word).toLowerCase(), {
                            word: row.word,
                            responses: Array.isArray(responses) ? responses : [String(responses)],
                            settings: Object.assign({ enabled: true, chance: 100, cooldown: 0 }, settings),
                            used_count: row.used_count || 0,
                            last_used: row.last_used || null,
                            created_at: row.created_at
                        });
                    } catch {
                        // ignore malformed trigger row
                    }
                }
            }
            core.log('triggers', `Loaded ${triggers.size} triggers from database`);
        } catch (dbErr) {
            core.log('triggers', `Error loading triggers: ${dbErr.message}`);
        }

        // Подписка на шину сообщений
        module.exports._onMessage = async (ctx) => {
            if (!ctx || !ctx.text || triggers.size === 0) return;
            const text = String(ctx.text);
            const lowerText = text.toLowerCase();
            const senderId = ctx.senderId || (ctx.fromId ? ctx.fromId : 0);
            const chatId = ctx.chatId || ctx.peerId || 0;

            for (const [w, trigger] of triggers) {
                if (!trigger.settings || !trigger.settings.enabled) continue;
                if (!checkTriggerConditions(trigger, senderId, chatId)) continue;

                // Кулдаун
                if (trigger.settings.cooldown > 0 && trigger.last_used) {
                    const diff = Date.now() - new Date(trigger.last_used).getTime();
                    if (diff < trigger.settings.cooldown * 1000) continue;
                }

                // Шанс
                if (trigger.settings.chance < 100) {
                    const roll = Math.random() * 100;
                    if (roll > trigger.settings.chance) continue;
                }

                // Совпадение
                let isMatch = false;
                if (trigger.settings.regex) {
                    try {
                        const flags = trigger.settings.caseSensitive ? '' : 'i';
                        const re = new RegExp(trigger.word, flags);
                        isMatch = re.test(text);
                    } catch {
                        continue;
                    }
                } else {
                    const searchTarget = trigger.settings.caseSensitive ? text : lowerText;
                    const searchWord = trigger.settings.caseSensitive ? trigger.word : w;
                    isMatch = searchTarget.includes(searchWord);
                }

                if (isMatch) {
                    // Выбираем случайный ответ
                    const responses = trigger.responses || [];
                    if (responses.length === 0) continue;
                    let reply = responses[Math.floor(Math.random() * responses.length)];

                    // Подстановка переменных
                    reply = reply
                        .replace(/\{user_id\}/g, String(senderId))
                        .replace(/\{chat_id\}/g, String(chatId))
                        .replace(/\{trigger_word\}/g, String(trigger.word))
                        .replace(/\{trigger_count\}/g, String(trigger.used_count || 0))
                        .replace(/\{time\}/g, new Date().toLocaleTimeString('ru-RU'))
                        .replace(/\{date\}/g, new Date().toLocaleDateString('ru-RU'))
                        .replace(/\{random\}/g, String(Math.floor(Math.random() * 100)));

                    try {
                        let client = null;
                        try {
                            const tgService = core.get('telegram');
                            client = tgService ? tgService.getClient() : null;
                        } catch {
                            // ignore
                        }

                        if (client && typeof client.sendMessage === 'function') {
                            await client.sendMessage(chatId, { message: reply });
                        }

                        // Обновляем статистику
                        trigger.used_count = (trigger.used_count || 0) + 1;
                        trigger.last_used = new Date().toISOString();
                        await db.run(
                            `UPDATE triggers SET used_count = ?, last_used = ? WHERE LOWER(word) = ?`,
                            [trigger.used_count, trigger.last_used, w]
                        );
                    } catch (e) {
                        core.log('triggers', `Error executing trigger: ${e.message}`);
                    }
                    break;
                }
            }
        };

        core.on('message', module.exports._onMessage);
    },

    async stop(core) {
        module.exports.triggersMap.clear();
        core.log('triggers', 'Triggers module stopped');
    }
};
