/**
 * Templates Feature Module
 * Commands: шаб (шаблон), шаблоны
 * Database: templates table
 */

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

function getTemplateTypeIcon(contentType) {
    switch (contentType) {
        case 'photo': return '🖼️';
        case 'video': return '🎥';
        case 'voice': return '🎤';
        case 'video_note': return '📹';
        case 'document': return '📁';
        case 'sticker': return '🎭';
        default: return '📝';
    }
}

async function listTemplatesHandler(core, context, ...rest) {
    const { chatId, messageId } = parseContext(core, context, ...rest);
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const db = core.get('db');
    const prefix = settings.get('prefix', '.');

    const templates = await db.all(`SELECT name, content_type, used_count FROM templates ORDER BY name ASC`);
    if (!templates || templates.length === 0) {
        await messaging.editMessage(chatId, messageId, '📋 Шаблоны не настроены');
        return;
    }

    let response = `📋 СПИСОК ШАБЛОНОВ (${templates.length}):\n\n`;
    templates.forEach((template, index) => {
        const typeIcon = getTemplateTypeIcon(template.content_type);
        response += `${typeIcon} ${index + 1}. "${template.name}"\n`;
        response += `   📊 Использован: ${template.used_count || 0} раз\n\n`;
    });

    response += `💡 Использование:\n` +
        `• ${prefix}шаб + [название] (в ответ на сообщение) - сохранить\n` +
        `• ${prefix}шаб [название] - отправить\n` +
        `• ${prefix}шаб - [название] - удалить\n` +
        `• ${prefix}шаб info [название] - инфо`;

    await messaging.editMessage(chatId, messageId, response);
}

module.exports = {
    name: 'templates',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db', 'messaging', 'settings', 'telegram'],

    commands: {
        'шаб': {
            aliases: ['шаблон'],
            help: 'Управление шаблонами сообщений (+, -, info, [имя])',
            async handler(core, context, ...rest) {
                const { args, message, chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const db = core.get('db');
                const prefix = settings.get('prefix', '.');

                if (args.length === 0) {
                    const helpText = `📋 УПРАВЛЕНИЕ ШАБЛОНАМИ\n\n` +
                        `• ${prefix}шаб + [имя] - Сохранить сообщение в шаблон (ответом)\n` +
                        `• ${prefix}шаб [имя] - Использовать шаблон\n` +
                        `• ${prefix}шаб - [имя] - Удалить шаблон\n` +
                        `• ${prefix}шаб info [имя] - Информация о шаблоне\n` +
                        `• ${prefix}шаблоны - Список всех шаблонов`;
                    await messaging.editMessage(chatId, messageId, helpText);
                    return;
                }

                const action = args[0].toLowerCase();
                const templateName = args[1];

                try {
                    switch (action) {
                        case '+':
                        case 'add':
                        case 'создать': {
                            if (!templateName) throw new Error('Укажите название шаблона');
                            if (!message || !message.replyTo || !message.replyTo.replyToMsgId) {
                                throw new Error('Ответьте на сообщение, которое хотите сохранить как шаблон');
                            }

                            const tgClient = core.get('telegram').getClient();
                            if (!tgClient || typeof tgClient.getMessages !== 'function') {
                                throw new Error('Telegram клиент недоступен для чтения сообщения');
                            }

                            const repliedMessages = await tgClient.getMessages(chatId, {
                                ids: [message.replyTo.replyToMsgId]
                            });

                            if (!repliedMessages || !repliedMessages[0]) {
                                throw new Error('Не удалось найти целевое сообщение');
                            }

                            const target = repliedMessages[0];
                            const textContent = target.text || '';
                            const contentType = 'text';

                            await db.run(
                                `INSERT INTO templates (name, content_type, text_content, created_at)
                                 VALUES (?, ?, ?, ?)
                                 ON CONFLICT(name) DO UPDATE SET text_content = excluded.text_content, content_type = excluded.content_type`,
                                [templateName, contentType, textContent, new Date().toISOString()]
                            );

                            await messaging.editMessage(chatId, messageId,
                                `✅ Шаблон "${templateName}" успешно сохранен!\n\n💡 Используйте: ${prefix}шаб ${templateName}`
                            );
                            break;
                        }

                        case '-':
                        case 'remove':
                        case 'delete':
                        case 'del':
                        case 'удалить': {
                            if (!templateName) throw new Error('Укажите имя шаблона для удаления');
                            await db.run(`DELETE FROM templates WHERE LOWER(name) = ?`, [templateName.toLowerCase()]);
                            await messaging.editMessage(chatId, messageId, `🗑️ Шаблон "${templateName}" удален`);
                            break;
                        }

                        case 'info':
                        case 'инфо': {
                            if (!templateName) throw new Error('Укажите имя шаблона');
                            const row = await db.get(`SELECT * FROM templates WHERE LOWER(name) = ?`, [templateName.toLowerCase()]);
                            if (!row) throw new Error(`Шаблон "${templateName}" не найден`);

                            const info = `📋 Шаблон: "${row.name}"\n\n` +
                                `• Тип: ${getTemplateTypeIcon(row.content_type)} ${row.content_type}\n` +
                                `• Использований: ${row.used_count || 0}\n` +
                                `• Создан: ${row.created_at || 'неизвестно'}\n` +
                                `• Длина текста: ${(row.text_content || '').length} симв.`;
                            await messaging.editMessage(chatId, messageId, info);
                            break;
                        }

                        case 'list':
                        case 'список': {
                            await listTemplatesHandler(core, context, ...rest);
                            break;
                        }

                        default: {
                            // Использование шаблона по имени
                            const targetName = args[0].toLowerCase();
                            const row = await db.get(`SELECT * FROM templates WHERE LOWER(name) = ?`, [targetName]);
                            if (!row) {
                                await messaging.editMessage(chatId, messageId, `❌ Шаблон "${args[0]}" не найден`);
                                return;
                            }

                            // Удаляем команду вызова или редактируем
                            if (row.text_content) {
                                await messaging.editMessage(chatId, messageId, row.text_content);
                            }

                            // Инкрементируем счетчик
                            await db.run(`UPDATE templates SET used_count = used_count + 1 WHERE id = ?`, [row.id]);
                            break;
                        }
                    }
                } catch (err) {
                    await messaging.editMessage(chatId, messageId, `❌ Ошибка: ${err.message}`);
                }
            }
        },

        'шаблоны': {
            aliases: [],
            help: 'Список всех сохраненных шаблонов',
            handler: listTemplatesHandler
        }
    },

    async init(core) {
        core.log('templates', 'Templates module initialized');
    },

    async stop(core) {
        core.log('templates', 'Templates module stopped');
    }
};
