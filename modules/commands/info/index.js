'use strict';

/**
 * Info & Profile Section Module
 * Commands: инфо, о_себе, юзер, чат_инфо, аватар, дата_рег, айди, админы
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'cmd_info',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram', 'settings'],

    commands: {
        'инфо': {
            aliases: ['info'],
            help: 'Обзорная информация о текущем чате или профиле',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                try {
                    let title = 'Текущий диалог';
                    let membersCount = '—';
                    let chatType = 'Личные сообщения';

                    if (client && typeof client.getEntity === 'function') {
                        const entity = await client.getEntity(chatId);
                        if (entity) {
                            title = entity.title || entity.firstName || 'Диалог';
                            chatType = entity.className || 'Chat';
                            membersCount = entity.participantsCount || '—';
                        }
                    }

                    const card = `ℹ️ ОБЗОР ЧАТА\n${DIVIDER}\n` +
                        `📝 Название: ${title}\n` +
                        `🆔 ID: ${chatId}\n` +
                        `📊 Тип: ${chatType}\n` +
                        `👥 Участников: ${membersCount}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'инфо', error: e.message }));
                }
            }
        },

        'о_себе': {
            aliases: ['me'],
            help: 'Информация о собственном профиле Telegram',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                try {
                    const me = client && typeof client.getMe === 'function' ? await client.getMe() : null;
                    const id = me ? me.id : 'Неизвестно';
                    const name = me ? `${me.firstName || ''} ${me.lastName || ''}`.trim() : 'Владелец';
                    const username = me && me.username ? `@${me.username}` : 'нет';
                    const isPremium = me && me.premium ? '✅ Да' : '❌ Нет';

                    const card = `👤 МОЙ ПРОФИЛЬ\n${DIVIDER}\n` +
                        `📝 Имя: ${name}\n` +
                        `🔗 Юзернейм: ${username}\n` +
                        `🆔 ID: ${id}\n` +
                        `⭐ Премиум: ${isPremium}\n` +
                        `🛡️ Статус: Владелец LP-Bot\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'о_себе', error: e.message }));
                }
            }
        },

        'юзер': {
            aliases: ['user'],
            help: 'Подробное досье на пользователя',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) {
                    target = 'reply';
                }

                if (!target) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'юзер',
                        description: 'Показывает развернутое досье на пользователя Telegram.',
                        usage: ['[в ответ на сообщение] !юзер', '!юзер [@username или ID]'],
                        examples: ['(в ответ) !юзер', '!юзер @durov']
                    }));
                }

                try {
                    let user = null;
                    if (target === 'reply' && client && typeof client.getMessages === 'function') {
                        const msgs = await client.getMessages(ctx.chatId, { ids: [message.replyTo.replyToMsgId] });
                        if (msgs[0] && msgs[0].sender) user = msgs[0].sender;
                    } else if (client && typeof client.getEntity === 'function') {
                        user = await client.getEntity(target);
                    }

                    if (!user) {
                        return sendOutput(core, ctx, renderError({ command: 'юзер', error: 'Пользователь не найден' }));
                    }

                    const card = `📋 ДОСЬЕ ПОЛЬЗОВАТЕЛЯ\n${DIVIDER}\n` +
                        `👤 Имя: ${user.firstName || ''} ${user.lastName || ''}\n` +
                        `🔗 Юзернейм: ${user.username ? '@' + user.username : 'нет'}\n` +
                        `🆔 ID: ${user.id}\n` +
                        `🤖 Бот: ${user.bot ? 'Да' : 'Нет'}\n` +
                        `⭐ Премиум: ${user.premium ? 'Да' : 'Нет'}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'юзер', error: e.message }));
                }
            }
        },

        'чат_инфо': {
            aliases: ['chat'],
            help: 'Детальная сводка о текущем чате',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                try {
                    let title = 'Чат';
                    let count = '—';
                    let username = 'нет';
                    let slow = 'выключен';

                    if (client && typeof client.getEntity === 'function') {
                        const entity = await client.getEntity(chatId);
                        if (entity) {
                            title = entity.title || entity.firstName || 'Чат';
                            count = entity.participantsCount || '—';
                            username = entity.username ? '@' + entity.username : 'нет';
                            slow = entity.slowmodeSeconds ? `${entity.slowmodeSeconds} сек.` : 'выключен';
                        }
                    }

                    const card = `💬 КАРТОЧКА ЧАТА\n${DIVIDER}\n` +
                        `📝 Название: ${title}\n` +
                        `🆔 ID: ${chatId}\n` +
                        `🔗 Ссылка: ${username}\n` +
                        `👥 Участников: ${count}\n` +
                        `⏳ Медленный режим: ${slow}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'чат_инфо', error: e.message }));
                }
            }
        },

        'аватар': {
            aliases: ['ava'],
            help: 'Получить аватарку профиля или чата',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                let target = args && args[0];
                if (!target && message && message.replyTo && message.replyTo.replyToMsgId) target = 'reply';
                if (!target) target = chatId;

                try {
                    if (client && typeof client.downloadProfilePhoto === 'function') {
                        await client.downloadProfilePhoto(target);
                    }
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'АВАТАР ПОЛУЧЕН',
                        items: [`Цель: ${target}`, 'Фотография профиля успешно загружена']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'аватар', error: e.message }));
                }
            }
        },

        'дата_рег': {
            aliases: ['reg'],
            help: 'Расчет примерной даты регистрации аккаунта',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const rawId = args && args[0] ? parseInt(args[0], 10) : (ctx.message && ctx.message.senderId ? Number(ctx.message.senderId) : 0);

                if (!rawId || isNaN(rawId)) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'дата_рег',
                        description: 'Определяет приблизительную дату регистрации Telegram аккаунта по его ID.',
                        usage: ['!дата_рег [user_id]'],
                        examples: ['!дата_рег 123456789']
                    }));
                }

                let approxYear = '2016-2018';
                if (rawId < 10000000) approxYear = '2013-2014 (Ранний Telegram)';
                else if (rawId < 100000000) approxYear = '2015-2016';
                else if (rawId < 500000000) approxYear = '2017-2018';
                else if (rawId < 1000000000) approxYear = '2019-2020';
                else if (rawId < 2000000000) approxYear = '2021-2022';
                else approxYear = '2023-2026 (Новый аккаунт)';

                const card = `📅 ДАТА РЕГИСТРАЦИИ\n${DIVIDER}\n` +
                    `🆔 ID пользователя: ${rawId}\n` +
                    `📆 Примерный период: ${approxYear}\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'айди': {
            aliases: ['id'],
            help: 'Быстрый вывод ID чата и пользователя',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { chatId, message } = ctx;
                const senderId = message && message.senderId ? message.senderId : '—';
                const replyId = message && message.replyTo && message.replyTo.replyToMsgId ? message.replyTo.replyToMsgId : null;

                let card = `🆔 ЧИСЛОВЫЕ ID\n${DIVIDER}\n` +
                    `💬 ID текущего чата: ${chatId}\n` +
                    `👤 ID автора: ${senderId}\n`;
                if (replyId) card += `📩 ID отвеченного сообщения: ${replyId}\n`;
                card += `${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'админы': {
            aliases: ['admins'],
            help: 'Список администраторов чата',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { chatId } = ctx;
                const telegramService = core.get('telegram');
                const client = telegramService.getClient ? telegramService.getClient() : (telegramService.client || null);

                try {
                    let admins = [];
                    if (client && typeof client.getParticipants === 'function') {
                        admins = await client.getParticipants(chatId, { filter: { _: 'channelParticipantsAdmins' } });
                    }

                    if (!admins || admins.length === 0) {
                        return sendOutput(core, ctx, `👑 АДМИНИСТРАТОРЫ ЧАТА\n${DIVIDER}\n• Список скрыт или недоступен в ЛС.\n${DIVIDER}`);
                    }

                    let lines = admins.slice(0, 15).map((a, i) => {
                        const name = a.firstName || a.username || `Админ #${a.id}`;
                        return `   ${i + 1}. ${name} (ID: ${a.id})`;
                    }).join('\n');

                    const card = `👑 АДМИНИСТРАТОРЫ ЧАТА (${admins.length})\n${DIVIDER}\n${lines}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'админы', error: e.message }));
                }
            }
        }
    },

    async init(core) {
        core.log('cmd_info', 'Модуль cmd_info (8 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_info', 'Модуль cmd_info остановлен');
    }
};
