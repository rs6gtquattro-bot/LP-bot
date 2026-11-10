'use strict';

/**
 * Help & Navigation Section Module
 * Commands: хелп (помощь, help), кмд (cmd), раздел, команды, о_боте, версия
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

const SECTIONS = [
    { id: 1, name: 'МОДЕРАЦИЯ ЧАТА', icon: '🛡️', count: 10, cmds: 'кик, бан, разбан, мут, размут, варн, снять_варны, медленный_режим, закреп, откреп' },
    { id: 2, name: 'УПРАВЛЕНИЕ СООБЩЕНИЯМИ', icon: '💬', count: 8, cmds: 'смс, очистить, цитата, спойлер, редактировать, копия, пинг, прочитать' },
    { id: 3, name: 'ИНФОРМАЦИЯ И ПРОФИЛЬ', icon: 'ℹ️', count: 8, cmds: 'инфо, о_себе, юзер, чат_инфо, аватар, дата_рег, айди, админы' },
    { id: 4, name: 'НАСТРОЙКИ БОТА', icon: '⚙️', count: 8, cmds: 'префикс, режим_ответа, мультипрефикс, статус, автостатус, уведомления, настройки, сброс_настроек' },
    { id: 5, name: 'БЕЗОПАСНОСТЬ И ДОСТУП', icon: '🔒', count: 7, cmds: 'доступ, доверить, отозвать, чс_чат, бс_чат, доверенные, чат_статус' },
    { id: 6, name: 'ТАЙМЕРЫ И НАПОМИНАНИЯ', icon: '⏰', count: 6, cmds: 'таймер, таймеры, стоп_таймер, напомнить, напоминания, удалить_напоминание' },
    { id: 7, name: 'ТРИГГЕРЫ И АВТООТВЕТЫ', icon: '⚡', count: 6, cmds: 'триггер, триггеры, триггер_удалить, автоответ, автоответы, стоп_автоответ' },
    { id: 8, name: 'ЗАМЕТКИ', icon: '📝', count: 5, cmds: 'заметка, заметки, заметка_показать, заметка_удалить, заметка_очистить' },
    { id: 9, name: 'УТИЛИТЫ И ИНСТРУМЕНТЫ', icon: '🛠️', count: 8, cmds: 'калькулятор, qr, чек_qr, время, погода, курс, перевод, сократить' },
    { id: 10, name: 'СТАТИСТИКА И ДИАГНОСТИКА', icon: '📊', count: 6, cmds: 'стат, аптайм, память, пинг_сети, сообщения_граф, топ_слов' },
    { id: 11, name: 'СЕТЬ И МОСТЫ', icon: '🌐', count: 4, cmds: 'прокси, тг_статус, вк_статус, проверить_порт' },
    { id: 12, name: 'СПРАВКА И НАВИГАЦИЯ', icon: '📋', count: 6, cmds: 'хелп, кмд, раздел, команды, о_боте, версия' }
];

module.exports = {
    name: 'cmd_help',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'process'],

    commands: {
        'хелп': {
            aliases: ['help', 'помощь'],
            help: 'Главное меню справки и каталог разделов',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');
                const p = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';

                if (args && args.length > 0) {
                    const query = args[0].toLowerCase();
                    const sec = SECTIONS.find(s => s.id === Number(query) || s.name.toLowerCase().includes(query));
                    if (sec) {
                        const secCard = `${sec.icon} РАЗДЕЛ: ${sec.name}\n${DIVIDER}\n` +
                            `🔢 Команд в разделе: ${sec.count}\n` +
                            `📋 Команды:\n` +
                            sec.cmds.split(', ').map(c => `   🔹 ${p}${c}`).join('\n') + `\n${DIVIDER}\n` +
                            `💡 Вызовите любую команду без аргументов для мануала.`;
                        return sendOutput(core, ctx, secCard);
                    }
                }

                let lines = SECTIONS.map(s => `   ${s.icon} ${s.id}. ${s.name} (${s.count})`).join('\n');
                const total = SECTIONS.reduce((acc, s) => acc + s.count, 0);

                const menu = `🤖 LP-BOT — СПРАВКА И НАВИГАЦИЯ 🤖\n${DIVIDER}\n` +
                    `📋 Всего команд: ${total} в 12 разделах\n` +
                    `⌨️ Текущий префикс: ${p}\n${DIVIDER}\n\n` +
                    `РАЗДЕЛЫ КОМАНД:\n${lines}\n\n${DIVIDER}\n` +
                    `💡 ${p}раздел [номер] — команды раздела\n` +
                    `💡 ${p}кмд — компактный список всех команд`;
                return sendOutput(core, ctx, menu);
            }
        },

        'кмд': {
            aliases: ['cmd'],
            help: 'Компактный список всех команд бота',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const settings = core.get('settings');
                const p = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';

                let body = SECTIONS.map(s => {
                    return `${s.icon} ${s.name}:\n` + s.cmds.split(', ').map(c => `   🔹 ${p}${c}`).join('\n');
                }).join('\n\n');

                const total = SECTIONS.reduce((acc, s) => acc + s.count, 0);
                const card = `📋 ВСЕ КОМАНДЫ LP-BOT (${total})\n${DIVIDER}\n\n${body}\n\n${DIVIDER}\n` +
                    `⚡ LP-Bot Core v2.0.0 • Для справки: ${p}хелп`;
                return sendOutput(core, ctx, card);
            }
        },

        'раздел': {
            aliases: ['section'],
            help: 'Просмотр команд конкретного раздела',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const settings = core.get('settings');
                const p = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';

                if (!args || args.length === 0) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'раздел',
                        description: 'Отображает список команд выбранного раздела.',
                        usage: ['!раздел [номер от 1 до 12]', '!раздел [имя раздела]'],
                        examples: ['!раздел 1 — модерация', '!раздел заметки']
                    }));
                }

                const query = args.join(' ').toLowerCase();
                const sec = SECTIONS.find(s => s.id === Number(query) || s.name.toLowerCase().includes(query));
                if (!sec) {
                    return sendOutput(core, ctx, renderError({
                        command: 'раздел',
                        error: `Раздел «${args.join(' ')}» не найден.`,
                        hint: `Список всех разделов: ${p}хелп`
                    }));
                }

                const card = `${sec.icon} РАЗДЕЛ: ${sec.name}\n${DIVIDER}\n` +
                    `🔢 Команд в разделе: ${sec.count}\n` +
                    `📋 Список команд:\n` +
                    sec.cmds.split(', ').map(c => `   🔹 ${p}${c}`).join('\n') + `\n${DIVIDER}\n` +
                    `💡 Вызовите команду без аргументов для получения подробной инструкции.`;
                return sendOutput(core, ctx, card);
            }
        },

        'команды': {
            aliases: ['commands'],
            help: 'Список всех команд бота',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const settings = core.get('settings');
                const p = settings && typeof settings.get === 'function' ? settings.get('prefix', '!') : '!';

                let lines = SECTIONS.map(s => `   ${s.icon} ${s.name}: ${s.cmds.split(', ').map(c => p + c).join(', ')}`).join('\n\n');
                const card = `🤖 КАТАЛОГ КОМАНД LP-BOT 🤖\n${DIVIDER}\n\n${lines}\n\n${DIVIDER}\n` +
                    `💡 Для подробного мануала введите команду без параметров.`;
                return sendOutput(core, ctx, card);
            }
        },

        'о_боте': {
            aliases: ['about'],
            help: 'Информация о проекте LP-Bot',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const card = `🤖 О ПРОЕКТЕ LP-BOT 🤖\n${DIVIDER}\n` +
                    `⚡ Высокопроизводительный модульный Telegram Userbot & VK Bot.\n` +
                    `🛠️ Стек: Node.js, Telegram GramJS, SQLite3 (WAL mode), Electron GUI.\n` +
                    `🔒 Безопасность: 100% fail-closed, строгая валидация, 0 внешних CDN.\n` +
                    `📦 Архитектура: Модульное микроядро с изоляцией сбоев.\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'версия': {
            aliases: ['version'],
            help: 'Версия бота и движка',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const card = `📌 ВЕРСИЯ LP-BOT\n${DIVIDER}\n` +
                    `⚡ Core Engine: v2.0.0\n` +
                    `📦 Release: 3.0.0-modular\n` +
                    `🟢 Статус: Production Ready\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        }
    },

    async init(core) {
        core.log('cmd_help', 'Модуль cmd_help (6 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_help', 'Модуль cmd_help остановлен');
    }
};
