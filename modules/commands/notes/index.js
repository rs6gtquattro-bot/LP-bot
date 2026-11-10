'use strict';

/**
 * Notes Section Module
 * Commands: заметка, заметки, заметка_показать, заметка_удалить, заметка_очистить
 * Uses core 'db' service methods (saveNote, getNote, listNotes, deleteNote)
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'cmd_notes',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db', 'messaging', 'settings'],

    commands: {
        'заметка': {
            aliases: ['note', 'n'],
            help: 'Сохранить заметку',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message } = ctx;
                const db = core.get('db');

                const name = args && args[0] ? args[0].trim().toLowerCase() : null;
                let content = args && args.slice(1).join(' ');

                if (!content && message && message.replyTo && message.replyTo.replyToMsgId) {
                    content = '[Ответ на сообщение]';
                }

                if (!name || !content) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'заметка',
                        description: 'Сохраняет текст или сниппет в персональную базу заметок.',
                        usage: ['!заметка [название] [содержимое]'],
                        examples: [
                            '!заметка правила Не спамить, не флудить',
                            '!заметка кошелек ТRC20: TXYZ12345...'
                        ]
                    }));
                }

                try {
                    await db.saveNote(name, content);
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ЗАМЕТКА СОХРАНЕНА',
                        items: [`Название: «${name}»`, `Длина: ${content.length} симв.`]
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'заметка', error: e.message }));
                }
            }
        },

        'заметки': {
            aliases: ['notes'],
            help: 'Список всех сохраненных заметок',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const db = core.get('db');

                try {
                    const rows = await db.listNotes(100, 0);
                    if (!rows || rows.length === 0) {
                        return sendOutput(core, ctx, `📝 ЗАМЕТКИ\n${DIVIDER}\nУ вас пока нет сохраненных заметок.\nСоздайте первую: !заметка [имя] [текст]\n${DIVIDER}`);
                    }

                    const lines = rows.map((r, i) => `   ${i + 1}. 📄 ${r.name} (${String(r.content).length} симв.)`).join('\n');
                    const card = `📝 ВАШИ ЗАМЕТКИ (${rows.length})\n${DIVIDER}\n${lines}\n${DIVIDER}\n💡 Для просмотра: !заметка_показать [имя]`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'заметки', error: e.message }));
                }
            }
        },

        'заметка_показать': {
            aliases: ['getnote'],
            help: 'Показать содержимое заметки',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const db = core.get('db');

                const name = args && args[0] ? args[0].trim().toLowerCase() : null;
                if (!name) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'заметка_показать',
                        description: 'Отображает текст сохраненной заметки.',
                        usage: ['!заметка_показать [название]'],
                        examples: ['!заметка_показать правила']
                    }));
                }

                try {
                    const note = await db.getNote(name);
                    if (!note) {
                        return sendOutput(core, ctx, renderError({
                            command: 'заметка_показать',
                            error: `Заметка «${name}» не найдена`,
                            hint: 'Список всех заметок: !заметки'
                        }));
                    }

                    const card = `📄 ЗАМЕТКА: ${note.name.toUpperCase()}\n${DIVIDER}\n${note.content}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'заметка_показать', error: e.message }));
                }
            }
        },

        'заметка_удалить': {
            aliases: ['delnote'],
            help: 'Удалить заметку по названию',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const db = core.get('db');

                const name = args && args[0] ? args[0].trim().toLowerCase() : null;
                if (!name) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'заметка_удалить',
                        description: 'Удаляет заметку из базы данных.',
                        usage: ['!заметка_удалить [название]'],
                        examples: ['!заметка_удалить правила']
                    }));
                }

                try {
                    const res = await db.deleteNote(name);
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ЗАМЕТКА УДАЛЕНА',
                        items: [`Заметка «${name}» успешно удалена.`]
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'заметка_удалить', error: e.message }));
                }
            }
        },

        'заметка_очистить': {
            aliases: ['clearnotes'],
            help: 'Очистить все заметки',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const db = core.get('db');

                if (!args || args[0] !== 'confirm') {
                    return sendOutput(core, ctx, renderManual({
                        command: 'заметка_очистить',
                        description: 'Безвозвратно удаляет все сохраненные заметки.',
                        usage: ['!заметка_очистить confirm'],
                        notes: ['Требуется подтверждение параметром confirm.']
                    }));
                }

                try {
                    await db.run('DELETE FROM notes');
                    return sendOutput(core, ctx, renderSuccess({
                        title: 'ВСЕ ЗАМЕТКИ ОЧИЩЕНЫ',
                        items: ['База заметок пуста.']
                    }));
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'заметка_очистить', error: e.message }));
                }
            }
        }
    },

    async init(core) {
        core.log('cmd_notes', 'Модуль cmd_notes (5 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_notes', 'Модуль cmd_notes остановлен');
    }
};
