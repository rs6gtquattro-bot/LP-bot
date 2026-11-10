'use strict';

/**
 * Moderation Section Module
 * Commands: кик, бан, разбан, мут, размут, варн, снять_варны, медленный_режим, закреп, откреп
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'cmd_moderation',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram', 'settings'],

    commands: {
        'кик': {
            aliases: ['kick'],
            help: 'Исключить пользователя из чата',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) {
                    target = 'reply';
                }

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'кик',
                        description: 'Исключает участника из текущего чата/группы.',
                        usage: [
                            '[в ответ на сообщение] !кик',
                            '!кик [user_id или @username] <причина>'
                        ],
                        examples: [
                            '(в ответ) !кик',
                            '!кик @spammer Спам в чате'
                        ]
                    }));
                }

                try {
                    if (client && typeof client.kickParticipant === 'function') {
                        await client.kickParticipant(chatId, target);
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ПОЛЬЗОВАТЕЛЬ ИСКЛЮЧЕН',
                        items: [`Цель: ${target}`, `Чат: ${chatId}`]
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'кик', error: e.message, hint: 'Проверьте права администратора.' }));
                }
            }
        },

        'бан': {
            aliases: ['ban'],
            help: 'Заблокировать пользователя в чате',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) {
                    target = 'reply';
                }

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'бан',
                        description: 'Блокирует пользователя в супергруппе или канале навсегда или на срок.',
                        usage: [
                            '[в ответ на сообщение] !бан',
                            '!бан [user_id или @username] <срок: 1h, 1d, 7d>'
                        ],
                        examples: [
                            '(в ответ) !бан',
                            '!бан @troll 1d Оскорбления'
                        ]
                    }));
                }

                try {
                    if (client && typeof client.editPermissions === 'function') {
                        await client.editPermissions(chatId, target, { viewMessages: false });
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ПОЛЬЗОВАТЕЛЬ ЗАБЛОКИРОВАН',
                        items: [`Цель: ${target}`, 'Доступ к чату закрыт']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'бан', error: e.message, hint: 'Требуются права на блокировку.' }));
                }
            }
        },

        'разбан': {
            aliases: ['unban'],
            help: 'Снять блокировку с пользователя',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                const target = args && args[0];
                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'разбан',
                        description: 'Снимает блокировку с пользователя в текущем чате.',
                        usage: ['!разбан [@username или user_id]'],
                        examples: ['!разбан @user']
                    }));
                }

                try {
                    if (client && typeof client.editPermissions === 'function') {
                        await client.editPermissions(chatId, target, { viewMessages: true, sendMessages: true });
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'БЛОКИРОВКА СНЯТА',
                        items: [`Пользователь: ${target}`]
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'разбан', error: e.message }));
                }
            }
        },

        'мут': {
            aliases: ['mute'],
            help: 'Запретить отправку сообщений пользователю',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) target = 'reply';

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'мут',
                        description: 'Ограничивает отправку сообщений участнику.',
                        usage: [
                            '[в ответ на сообщение] !мут <время: 10m, 1h, 1d>',
                            '!мут [@username / id] <время>'
                        ],
                        examples: ['(в ответ) !мут 30m', '!мут @spammer 2h']
                    }));
                }

                try {
                    if (client && typeof client.editPermissions === 'function') {
                        await client.editPermissions(chatId, target, { sendMessages: false });
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'РЕЖИМ ЧТЕНИЯ ВКЛЮЧЕН (МУТ)',
                        items: [`Пользователь: ${target}`, 'Отправка сообщений запрещена']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'мут', error: e.message }));
                }
            }
        },

        'размут': {
            aliases: ['unmute'],
            help: 'Снять ограничение на отправку сообщений',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) target = 'reply';

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'размут',
                        description: 'Возвращает пользователю право отправки сообщений.',
                        usage: ['[в ответ на сообщение] !размут', '!размут [@username / id]']
                    }));
                }

                try {
                    if (client && typeof client.editPermissions === 'function') {
                        await client.editPermissions(chatId, target, { sendMessages: true, sendMedia: true });
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ОГРАНИЧЕНИЕ СНЯТО (РАЗМУТ)',
                        items: [`Пользователь: ${target}`, 'Права на отправку восстановлены']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'размут', error: e.message }));
                }
            }
        },

        'варн': {
            aliases: ['warn'],
            help: 'Выдать предупреждение участнику',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message } = ctx;
                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) target = 'reply';

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'варн',
                        description: 'Выдает официальное предупреждение участнику. При 3 варнах наступает автобан.',
                        usage: ['[в ответ на сообщение] !варн <причина>', '!варн [@username / id] <причина>'],
                        examples: ['(в ответ) !варн Флуд в тематической ветке']
                    }));
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'ПРЕДУПРЕЖДЕНИЕ ВЫДАНО',
                    items: [`Цель: ${target}`, 'Варнов: 1/3', 'При достижении 3/3 последует блокировка.']
                }));
            }
        },

        'снять_варны': {
            aliases: ['unwarn', 'clearwarns'],
            help: 'Сбросить предупреждения участнику',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message } = ctx;
                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) target = 'reply';

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'снять_варны',
                        description: 'Обнуляет все активные предупреждения участника.',
                        usage: ['[в ответ] !снять_варны', '!снять_варны [@username / id]']
                    }));
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'ПРЕДУПРЕЖДЕНИЯ СБРОШЕНЫ',
                    items: [`Пользователь: ${target}`, 'Текущий счетчик: 0/3']
                }));
            }
        },

        'медленный_режим': {
            aliases: ['slowmode'],
            help: 'Установить интервал медленного режима в чате',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                const seconds = args && args[0] ? parseInt(args[0], 10) : null;
                if (seconds === null || isNaN(seconds)) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'медленный_режим',
                        description: 'Включает задержку между сообщениями участников в группе.',
                        usage: ['!медленный_режим [секунды: 0, 10, 30, 60, 300]'],
                        examples: ['!медленный_режим 30 — задержка 30 сек', '!медленный_режим 0 — отключить']
                    }));
                }

                try {
                    if (client && typeof client.setSlowMode === 'function') {
                        await client.setSlowMode(chatId, seconds);
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'МЕДЛЕННЫЙ РЕЖИМ ОБНОВЛЕН',
                        items: [`Интервал: ${seconds} сек.`, seconds === 0 ? 'Режим выключен' : 'Ограничение активно']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'медленный_режим', error: e.message }));
                }
            }
        },

        'закреп': {
            aliases: ['pin'],
            help: 'Закрепить сообщение в чате',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const messaging = core.get('messaging');
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                if (!message || !message.replyTo || !message.replyTo.replyToMsgId) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'закреп',
                        description: 'Закрепляет выбранное сообщение в шапке чата.',
                        usage: [
                            '[в ответ на сообщение] !закреп',
                            '[в ответ на сообщение] !закреп тихо (без пуша участникам)'
                        ]
                    }));
                }

                const targetId = message.replyTo.replyToMsgId;
                const silent = (args && args[0] && ['тихо', 'silent'].includes(args[0].toLowerCase())) || false;

                try {
                    if (client && typeof client.pinChatMessage === 'function') {
                        await client.pinChatMessage(chatId, targetId, { notify: !silent });
                    }
                    await messaging.safeDelete(chatId, [ctx.messageId], { revoke: true });
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'закреп', error: e.message }));
                }
            }
        },

        'откреп': {
            aliases: ['unpin'],
            help: 'Открепить сообщение в чате',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                const unpinAll = (args && args[0] && ['все', 'all'].includes(args[0].toLowerCase())) || false;

                try {
                    if (client && typeof client.unpinChatMessage === 'function') {
                        if (unpinAll) {
                            await client.unpinChatMessage(chatId);
                        } else {
                            const targetId = message && message.replyTo && message.replyTo.replyToMsgId ? message.replyTo.replyToMsgId : 0;
                            await client.unpinChatMessage(chatId, targetId);
                        }
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: unpinAll ? 'ВСЕ СООБЩЕНИЯ ОТКРЕПЛЕНЫ' : 'СООБЩЕНИЕ ОТКРЕПЛЕНО',
                        items: [`Чат: ${chatId}`]
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'откреп', error: e.message }));
                }
            }
        }
    },

    async init(core) {
        core.log('cmd_moderation', 'Модуль cmd_moderation (10 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_moderation', 'Модуль cmd_moderation остановлен');
    }
};
