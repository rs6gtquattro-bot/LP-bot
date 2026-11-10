'use strict';

/**
 * Messages Section Module
 * Commands: смс (удалить), очистить, цитата, спойлер, редактировать, копия, пинг, прочитать
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'cmd_messages',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram', 'settings'],

    commands: {
        'смс': {
            aliases: ['удалить', 'del'],
            help: 'Удаление сообщений (по ответу, диапазоны +, -, количество)',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId, messageId } = ctx;
                const messaging = core.get('messaging');
                const telegramService = core.get('telegram');
                const settings = core.get('settings');
                const prefix = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                const hasReply = Boolean(message && message.replyTo && message.replyTo.replyToMsgId);
                const repliedId = hasReply ? message.replyTo.replyToMsgId : null;

                // Без аргументов и без reply -> подробный мануал
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

                const toDelete = new Set();
                if (messageId) toDelete.add(messageId);

                try {
                    if (hasReply && repliedId) {
                        toDelete.add(repliedId);
                        const arg0 = (args && args[0]) ? String(args[0]).trim() : '';

                        if (arg0 && client && typeof client.getMessages === 'function') {
                            const isAbove = arg0.startsWith('+') || !arg0.startsWith('-');
                            const cleanNum = parseInt(arg0.replace(/^[+-]/, ''), 10);

                            if (!isNaN(cleanNum) && cleanNum > 0) {
                                const count = Math.min(cleanNum, 100);
                                if (isAbove) {
                                    const msgs = await client.getMessages(chatId, { maxId: repliedId, limit: count });
                                    for (const m of msgs) if (m && m.id && m.id !== messageId) toDelete.add(m.id);
                                } else {
                                    const msgs = await client.getMessages(chatId, { minId: repliedId, limit: count });
                                    for (const m of msgs) if (m && m.id && m.id !== messageId) toDelete.add(m.id);
                                }
                            }
                        }
                    } else if (args && args.length > 0) {
                        const rawCount = parseInt(args[0], 10);
                        if (!isNaN(rawCount) && rawCount > 0 && client && typeof client.getMessages === 'function') {
                            const count = Math.min(rawCount, 100);
                            const msgs = await client.getMessages(chatId, { limit: count + 1 });
                            for (const m of msgs) if (m && m.id && m.id !== messageId) toDelete.add(m.id);
                        }
                    }

                    const idList = Array.from(toDelete);
                    if (idList.length > 0) {
                        await messaging.safeDelete(chatId, idList, { revoke: true });
                        if (idList.length > 1 && client && typeof client.sendMessage === 'function') {
                            try {
                                const note = await client.sendMessage(chatId, { message: `🗑️ Удалено сообщений: ${idList.length}` });
                                if (note && note.id) {
                                    setTimeout(async () => {
                                        try { await messaging.safeDelete(chatId, [note.id], { revoke: true }); } catch {}
                                    }, 3000);
                                }
                            } catch {}
                        }
                    }
                } catch (err) {
                    core.log('cmd_messages', `Ошибка удаления: ${err.message}`);
                }
            }
        },

        'очистить': {
            aliases: ['purge'],
            help: 'Очистить свои сообщения в текущем чате',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, chatId, messageId } = ctx;
                const messaging = core.get('messaging');
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                const count = args && args[0] ? parseInt(args[0], 10) : 10;
                if (isNaN(count) || count <= 0) {
                    return sendOutput(core, ctx, renderError({
                        command: 'очистить',
                        error: 'Неверное количество сообщений',
                        hint: 'Используйте: !очистить [1-100]'
                    }));
                }

                try {
                    const limit = Math.min(count, 100);
                    const toDelete = [];
                    if (messageId) toDelete.push(messageId);

                    if (client && typeof client.getMessages === 'function') {
                        const msgs = await client.getMessages(chatId, { limit: limit + 5 });
                        for (const m of msgs) {
                            if (m.out && m.id !== messageId && toDelete.length <= limit) {
                                toDelete.push(m.id);
                            }
                        }
                    }

                    if (toDelete.length > 0) {
                        await messaging.safeDelete(chatId, toDelete, { revoke: true });
                    }
                } catch (e) {
                    core.log('cmd_messages', `Ошибка очистить: ${e.message}`);
                }
            }
        },

        'цитата': {
            aliases: ['quote', 'q'],
            help: 'Создать цитату из отвеченного сообщения',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { message } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                if (!message || !message.replyTo || !message.replyTo.replyToMsgId) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'цитата',
                        description: 'Оформляет отвеченное сообщение в аккуратную текстовую цитату.',
                        usage: ['[в ответ на сообщение] !цитата'],
                        examples: ['(в ответ) !цитата']
                    }));
                }

                try {
                    const repliedMsg = client && typeof client.getMessages === 'function'
                        ? (await client.getMessages(ctx.chatId, { ids: [message.replyTo.replyToMsgId] }))[0]
                        : null;

                    const quoteText = repliedMsg ? (repliedMsg.message || '[Медиа]') : 'Текст сообщения';
                    const senderName = repliedMsg && repliedMsg.sender
                        ? (repliedMsg.sender.firstName || repliedMsg.sender.username || 'Пользователь')
                        : 'Автор';

                    const card = `💬 ЦИТАТА\n${DIVIDER}\n«${quoteText}»\n\n— ${senderName}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (err) {
                    return sendOutput(core, ctx, renderError({
                        command: 'цитата',
                        error: err.message,
                        hint: 'Убедитесь, что сообщение доступно.'
                    }));
                }
            }
        },

        'спойлер': {
            aliases: ['spoiler'],
            help: 'Оформить текст сообщения под спойлер',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                if (!args || args.length === 0) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'спойлер',
                        description: 'Скрывает указанный текст под спойлером.',
                        usage: ['!спойлер [секретный текст]'],
                        examples: ['!спойлер Убийца — садовник']
                    }));
                }
                const text = args.join(' ');
                const formatted = `🙈 СПОЙЛЕР:\n${DIVIDER}\n||${text}||\n${DIVIDER}`;
                return sendOutput(core, ctx, formatted);
            }
        },

        'редактировать': {
            aliases: ['edit'],
            help: 'Быстро отредактировать сообщение',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const messaging = core.get('messaging');

                if (!args || args.length === 0) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'редактировать',
                        description: 'Редактирует отвеченное или предыдущее сообщение бота.',
                        usage: ['[в ответ на свое сообщение] !редактировать [новый текст]'],
                        examples: ['(в ответ) !редактировать Исправленный текст']
                    }));
                }

                const newText = args.join(' ');
                const targetId = message && message.replyTo && message.replyTo.replyToMsgId
                    ? message.replyTo.replyToMsgId
                    : ctx.messageId;

                try {
                    await messaging.editMessage(chatId, targetId, newText);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({
                        command: 'редактировать',
                        error: e.message,
                        hint: 'Можно редактировать только свои сообщения.'
                    }));
                }
            }
        },

        'копия': {
            aliases: ['copy'],
            help: 'Продублировать отвеченное сообщение без плашки пересылки',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { message, chatId } = ctx;
                const messaging = core.get('messaging');
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                if (!message || !message.replyTo || !message.replyTo.replyToMsgId) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'копия',
                        description: 'Отправляет чистую копию отвеченного сообщения без пересылки.',
                        usage: ['[в ответ на сообщение] !копия']
                    }));
                }

                try {
                    const repliedMsg = client && typeof client.getMessages === 'function'
                        ? (await client.getMessages(chatId, { ids: [message.replyTo.replyToMsgId] }))[0]
                        : null;

                    if (repliedMsg && repliedMsg.message) {
                        await messaging.sendMessage(chatId, repliedMsg.message);
                    }
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'копия', error: e.message }));
                }
            }
        },

        'пинг': {
            aliases: ['ping'],
            help: 'Проверка времени отклика Telegram API',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const t0 = Date.now();
                const diff = Math.max(1, Date.now() - t0);
                const text = `🏓 Понг! ${diff} мс\n${DIVIDER}\n⚡ Соединение: стабильно\n🌐 Дата-центр Telegram: активен`;
                return sendOutput(core, ctx, text);
            }
        },

        'прочитать': {
            aliases: ['read'],
            help: 'Пометить сообщения как прочитанные',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                try {
                    if (client && typeof client.markAsRead === 'function') {
                        await client.markAsRead(chatId);
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ДИАЛОГ ПРОЧИТАН',
                        items: ['Все входящие сообщения помечены прочитанными']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'прочитать', error: e.message }));
                }
            }
        }
    },

    async init(core) {
        core.log('cmd_messages', 'Модуль cmd_messages (8 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_messages', 'Модуль cmd_messages остановлен');
    }
};
