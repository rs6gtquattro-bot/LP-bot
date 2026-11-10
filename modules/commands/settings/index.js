'use strict';

/**
 * Settings Section Module
 * Commands: префикс, режим_ответа, мультипрефикс, статус, автостатус, уведомления, настройки, сброс_настроек
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'cmd_settings',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['settings', 'messaging', 'process'],

    commands: {
        'префикс': {
            aliases: ['prefix'],
            help: 'Смена главного префикса команд',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');

                const newPrefix = args && args[0] ? args[0].trim() : null;
                if (!newPrefix || newPrefix.length > 3) {
                    const current = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';
                    return sendOutput(core, ctx, renderManual({
                        command: 'префикс',
                        description: `Устанавливает командный префикс (текущий: ${current}).`,
                        usage: ['!префикс [новый_символ]'],
                        examples: ['!префикс !', '!префикс .', '!префикс *'],
                        notes: ['Максимальная длина префикса — 3 символа.']
                    }));
                }

                if (settings && typeof settings.set === 'function') {
                    settings.set('prefix', newPrefix);
                    if (typeof settings.save === 'function') settings.save();
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'ПРЕФИКС ИЗМЕНЕН',
                    items: [`Новый префикс: ${newPrefix}`, 'Действует мгновенно в Telegram и VK']
                }));
            }
        },

        'режим_ответа': {
            aliases: ['reply_mode'],
            help: 'Режим вывода ответов бота (edit | reply)',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');
                const current = settings && typeof settings.get === 'function' ? settings.get('reply_mode', 'edit') : 'edit';

                const mode = args && args[0] ? args[0].toLowerCase() : null;
                if (!mode || !['edit', 'reply'].includes(mode)) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'режим_ответа',
                        description: `Выбор способа ответа бота (текущий: ${current}).`,
                        usage: ['!режим_ответа edit', '!режим_ответа reply'],
                        examples: [
                            '!режим_ответа edit — редактировать сообщение с командой',
                            '!режим_ответа reply — отправлять новое сообщение в ответ'
                        ]
                    }));
                }

                if (settings && typeof settings.set === 'function') {
                    settings.set('reply_mode', mode);
                    if (typeof settings.save === 'function') settings.save();
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'РЕЖИМ ОТВЕТА ОБНОВЛЕН',
                    items: [`Текущий режим: ${mode.toUpperCase()}`]
                }));
            }
        },

        'мультипрефикс': {
            aliases: ['multiprefix'],
            help: 'Включение/выключение поддержки альтернативных префиксов',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');

                const arg = args && args[0] ? args[0].toLowerCase() : null;
                if (!arg || !['вкл', 'выкл', 'on', 'off'].includes(arg)) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'мультипрефикс',
                        description: 'Позволяет боту отвечать на альтернативные префиксы (*, ., !, ,).',
                        usage: ['!мультипрефикс вкл', '!мультипрефикс выкл']
                    }));
                }

                const enabled = ['вкл', 'on'].includes(arg);
                if (settings && typeof settings.set === 'function') {
                    settings.set('multiprefix', enabled);
                    if (typeof settings.save === 'function') settings.save();
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'МУЛЬТИПРЕФИКС',
                    items: [`Статус: ${enabled ? 'ВКЛЮЧЕН (работают *, ., !, ,)' : 'ВЫКЛЮЧЕН (только основной)'}`]
                }));
            }
        },

        'статус': {
            aliases: ['status'],
            help: 'Текущий системный статус бота',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const proc = core.get('process');
                const uptime = proc && typeof proc.uptime === 'function' ? proc.uptime() : Math.floor(process.uptime());

                const card = `🤖 СТАТУС БОТА\n${DIVIDER}\n` +
                    `⚡ Ядро: LP-Bot Modular v2.0.0\n` +
                    `⏱️ Аптайм: ${uptime} сек.\n` +
                    `📦 Модулей активно: ${core.modules && core.modules.loaded ? core.modules.loaded.size : '—'}\n` +
                    `🛡️ Состояние: в норме ✅\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'автостатус': {
            aliases: ['autostatus'],
            help: 'Автоматическая ротация bio/статуса по расписанию',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');

                if (!args || args.length === 0) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'автостатус',
                        description: 'Управляет авторотацией bio профиля.',
                        usage: ['!автостатус [текст_шаблона]', '!автостатус выкл'],
                        examples: ['!автостатус LP-Bot Online | {time}', '!автостатус выкл']
                    }));
                }

                const action = args.join(' ');
                const enabled = action.toLowerCase() !== 'выкл';
                if (settings && typeof settings.set === 'function') {
                    settings.set('autoStatus', enabled);
                    if (enabled) settings.set('autoStatusText', action);
                    if (typeof settings.save === 'function') settings.save();
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'АВТОСТАТУС ОБНОВЛЕН',
                    items: [`Статус: ${enabled ? 'ВКЛЮЧЕН (' + action + ')' : 'ВЫКЛЮЧЕН'}`]
                }));
            }
        },

        'уведомления': {
            aliases: ['notifications', 'уведы'],
            help: 'Включение/выключение служебных уведомлений',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const settings = core.get('settings');
                const current = settings && typeof settings.get === 'function' ? settings.get('notifications', true) : true;
                const next = !current;

                if (settings && typeof settings.set === 'function') {
                    settings.set('notifications', next);
                    if (typeof settings.save === 'function') settings.save();
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'СЛУЖЕБНЫЕ УВЕДОМЛЕНИЯ',
                    items: [`Статус: ${next ? 'ВКЛЮЧЕНЫ 🔔' : 'ВЫКЛЮЧЕНЫ 🔕'}`]
                }));
            }
        },

        'настройки': {
            aliases: ['config'],
            help: 'Просмотр активной конфигурации бота',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const settings = core.get('settings');
                const p = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';
                const rm = settings && typeof settings.get === 'function' ? settings.get('reply_mode', 'edit') : 'edit';
                const notif = settings && typeof settings.get === 'function' ? settings.get('notifications', true) : true;
                const mp = settings && typeof settings.get === 'function' ? settings.get('multiprefix', false) : false;

                const card = `⚙️ НАСТРОЙКИ LP-BOT\n${DIVIDER}\n` +
                    `⌨️ Префикс: ${p}\n` +
                    `💬 Режим ответа: ${rm}\n` +
                    `🔀 Мультипрефикс: ${mp ? 'Да' : 'Нет'}\n` +
                    `🔔 Уведомления: ${notif ? 'Вкл' : 'Выкл'}\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'сброс_настроек': {
            aliases: ['reset_settings'],
            help: 'Сброс конфигурации бота к значениям по умолчанию',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');

                if (!args || args[0] !== 'confirm') {
                    return sendOutput(core, ctx, renderManual({
                        command: 'сброс_настроек',
                        description: 'Сбрасывает все настройки бота до заводских значений.',
                        usage: ['!сброс_настроек confirm'],
                        notes: ['Требуется подтверждение параметром confirm.']
                    }));
                }

                if (settings && typeof settings.set === 'function') {
                    settings.set('prefix', '!');
                    settings.set('reply_mode', 'edit');
                    settings.set('multiprefix', false);
                    settings.set('notifications', true);
                    if (typeof settings.save === 'function') settings.save();
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'НАСТРОЙКИ СБРОШЕНЫ',
                    items: ['Префикс: !', 'Режим ответа: edit', 'Мультипрефикс: выкл']
                }));
            }
        }
    },

    async init(core) {
        core.log('cmd_settings', 'Модуль cmd_settings (8 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_settings', 'Модуль cmd_settings остановлен');
    }
};
