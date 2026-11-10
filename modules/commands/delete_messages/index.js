'use strict';

/**
 * Delete Messages Module
 * Commands: смс, удалить
 * Deep deletion logic:
 * - No args, no reply -> detailed manual card
 * - Reply without args -> deletes replied message + command
 * - Reply + [N] / +[N] -> deletes replied message and N messages above it (earlier)
 * - Reply + -[N] -> deletes replied message and N messages below it (later)
 * - No reply + [N] -> deletes last N messages in chat + command
 */

const { DIVIDER, parseContext, renderManual, renderError, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'delete_messages',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram', 'settings'],

    commands: {
        'смс': {
            aliases: ['удалить'],
            help: 'Удаление сообщений (по ответу, диапазоны +, -, количество)',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId, messageId } = ctx;
                const messaging = core.get('messaging');
                const telegramService = core.get('telegram');
                const settings = core.get('settings');
                const prefix = (settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                const hasReply = Boolean(message && message.replyTo && message.replyTo.replyToMsgId);
                const repliedId = hasReply ? message.replyTo.replyToMsgId : null;

                // 1. Без аргументов и без ответа на сообщение -> Детальная инструкция (Мануал)
                if (!hasReply && (!args || args.length === 0)) {
                    const manualText = renderManual({
                        title: 'УДАЛЕНИЕ СООБЩЕНИЙ (СМС / УДАЛИТЬ)',
                        command: 'смс',
                        description: 'Удаление сообщений в текущем чате с поддержкой гибких диапазонов и смещений.',
                        usage: [
                            `[в ответ на сообщение] ${prefix}смс — удалить отвеченное сообщение`,
                            `${prefix}смс [N] — удалить последние N сообщений в чате`,
                            `[в ответ на сообщение] ${prefix}смс +[N] — удалить сообщение и N сообщений ВЫШЕ него`,
                            `[в ответ на сообщение] ${prefix}смс -[N] — удалить сообщение и N сообщений НИЖЕ него`,
                            `${prefix}смс все — очистка истории своих сообщений`
                        ],
                        examples: [
                            { cmd: `(в ответ) ${prefix}смс`, desc: 'удалит только выбранное сообщение' },
                            { cmd: `${prefix}смс 5`, desc: 'удалит последние 5 сообщений' },
                            { cmd: `(в ответ) ${prefix}смс +3`, desc: 'удалит сообщение и 3 штуки перед ним' },
                            { cmd: `(в ответ) ${prefix}смс -2`, desc: 'удалит сообщение и 2 штуки после него' }
                        ],
                        flags: [
                            { flag: '+N', desc: 'диапазон вверх (старее по времени)' },
                            { flag: '-N', desc: 'диапазон вниз (новее по времени)' }
                        ],
                        notes: [
                            'Лимит удаления: от 1 до 100 сообщений за один вызов.',
                            'Сообщения удаляются безвозвратно для всех участников.'
                        ]
                    });
                    return sendOutput(core, ctx, manualText);
                }

                // Сбор ID на удаление
                const toDelete = new Set();
                if (messageId) toDelete.add(messageId);

                try {
                    // 2. Есть ответ на сообщение
                    if (hasReply && repliedId) {
                        toDelete.add(repliedId);

                        const arg0 = (args && args[0]) ? String(args[0]).trim() : '';

                        if (arg0 && client && typeof client.getMessages === 'function') {
                            const isAbove = arg0.startsWith('+') || !arg0.startsWith('-');
                            const cleanNum = parseInt(arg0.replace(/^[+-]/, ''), 10);

                            if (!isNaN(cleanNum) && cleanNum > 0) {
                                const count = Math.min(cleanNum, 100);

                                if (isAbove) {
                                    // Сообщения выше (старее): id < repliedId
                                    const msgs = await client.getMessages(chatId, {
                                        maxId: repliedId,
                                        limit: count
                                    });
                                    for (const m of msgs) {
                                        if (m && m.id && m.id !== messageId) toDelete.add(m.id);
                                    }
                                } else {
                                    // Сообщения ниже (новее): id > repliedId
                                    const msgs = await client.getMessages(chatId, {
                                        minId: repliedId,
                                        limit: count
                                    });
                                    for (const m of msgs) {
                                        if (m && m.id && m.id !== messageId) toDelete.add(m.id);
                                    }
                                }
                            }
                        }
                    }
                    // 3. Нет ответа, но указано число последних сообщений
                    else if (args && args.length > 0) {
                        const rawCount = parseInt(args[0], 10);
                        if (!isNaN(rawCount) && rawCount > 0 && client && typeof client.getMessages === 'function') {
                            const count = Math.min(rawCount, 100);
                            const msgs = await client.getMessages(chatId, {
                                limit: count + 1
                            });
                            let added = 0;
                            for (const m of msgs) {
                                if (m && m.id && m.id !== messageId) {
                                    toDelete.add(m.id);
                                    added++;
                                    if (added >= count) break;
                                }
                            }
                        }
                    }

                    const idList = Array.from(toDelete);
                    if (idList.length > 0) {
                        await messaging.safeDelete(chatId, idList, { revoke: true });

                        // Временное подтверждение при удалении нескольких сообщений
                        if (idList.length > 1 && client && typeof client.sendMessage === 'function') {
                            try {
                                const note = await client.sendMessage(chatId, {
                                    message: `🗑️ Удалено сообщений: ${idList.length}`
                                });
                                if (note && note.id) {
                                    setTimeout(async () => {
                                        try {
                                            await messaging.safeDelete(chatId, [note.id], { revoke: true });
                                        } catch {}
                                    }, 3000);
                                }
                            } catch {}
                        }
                    }
                } catch (err) {
                    core.log('delete_messages', `Ошибка удаления: ${err.message}`);
                }
            }
        }
    },

    async init(core) {
        core.log('delete_messages', 'Модуль delete_messages (смс/удалить) инициализирован');
    },

    async stop(core) {
        core.log('delete_messages', 'Модуль delete_messages остановлен');
    }
};
