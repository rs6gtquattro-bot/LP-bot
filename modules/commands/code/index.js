const fs = require('fs');
const path = require('path');

/**
 * Code Management Module
 * Commands: код (code)
 * Safe file operations with path traversal and secret files protection.
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

function extractReplyCode(message) {
    if (message && message.replyTo && message.replyTo.replyToMsgId) {
        if (typeof message.replyTo.text === 'string' && message.replyTo.text.length > 0) {
            return message.replyTo.text;
        }
    }
    return null;
}

module.exports = {
    name: 'code',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['utils', 'users', 'messaging', 'settings', 'process'],

    commands: {
        'код': {
            aliases: ['code'],
            help: 'Безопасное управление исходным кодом бота',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message, chatId, senderId, messageId } = ctx;
                const users = core.get('users');
                const messaging = core.get('messaging');
                const utils = core.get('utils');
                const settings = core.get('settings');
                const processService = core.get('process');
                const prefix = settings.get('prefix', '.');

                // Строжайшая проверка прав: доступно только владельцу бота
                if (!users.isOwnerMessage({ message, senderId, out: message ? message.out : false })) {
                    await messaging.editMessage(chatId, messageId,
                        '❌ Критическая ошибка безопасности: управление кодом разрешено только владельцу бота'
                    );
                    return;
                }

                if (args.length === 0) {
                    const helpText = `🔧 КОМАНДЫ УПРАВЛЕНИЯ ИСХОДНЫМ КОДОМ\n\n` +
                        `📁 РАБОТА С ФАЙЛАМИ:\n` +
                        `• ${prefix}код показать [файл] - Показать содержимое файла\n` +
                        `• ${prefix}код список [папка] - Список файлов в директории\n` +
                        `• ${prefix}код инфо [файл] - Информация о файле\n\n` +
                        `✏️ РЕДАКТИРОВАНИЕ:\n` +
                        `• ${prefix}код редактировать [файл] - Заменить файл (ответом с кодом)\n` +
                        `• ${prefix}код добавить [файл] - Добавить код в конец (ответом)\n` +
                        `• ${prefix}код создать [файл] - Создать новый файл (ответом)\n` +
                        `• ${prefix}код удалить [файл] - Удалить файл\n\n` +
                        `🛡️ СИСТЕМА:\n` +
                        `• ${prefix}код бэкап [файл] - Создать бэкап файла\n` +
                        `• ${prefix}код восстановить [файл] [бэкап] - Восстановить из бэкапа\n` +
                        `• ${prefix}код перезагрузка - Перезагрузить бота\n\n` +
                        `📋 ПОДДЕРЖИВАЕМЫЕ ФАЙЛЫ:\n` +
                        `• .js, .json, .txt, .md, .html, .css\n` +
                        `• Максимальный размер: 500KB\n\n` +
                        `⚠️ БЕЗОПАСНОСТЬ:\n` +
                        `• Доступно только владельцу бота\n` +
                        `• Запрещены системные файлы и секреты`;

                    await messaging.editMessage(chatId, messageId, helpText);
                    return;
                }

                const action = args[0].toLowerCase();
                const subArgs = args.slice(1);

                try {
                    switch (action) {
                        case 'показать':
                        case 'show':
                        case 'view': {
                            if (subArgs.length === 0) throw new Error('Укажите путь к файлу');
                            const targetPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(targetPath)) {
                                throw new Error('Доступ к указанному файлу запрещен политикой безопасности');
                            }
                            if (!fs.existsSync(targetPath)) {
                                throw new Error(`Файл не существует: ${subArgs[0]}`);
                            }
                            const stats = fs.statSync(targetPath);
                            if (stats.isDirectory()) {
                                throw new Error('Указанный путь является директорией');
                            }
                            if (stats.size > 512000) {
                                throw new Error('Файл слишком большой для отображения (максимум 500KB)');
                            }
                            const content = fs.readFileSync(targetPath, 'utf8');
                            const ext = path.extname(targetPath).replace('.', '') || 'text';
                            const responseText = `📄 Файл: ${subArgs[0]} (${stats.size} байт)\n\`\`\`${ext}\n${content}\n\`\`\``;

                            if (responseText.length > 4000) {
                                const parts = messaging.splitMessage(responseText, 4000);
                                for (let i = 0; i < parts.length; i++) {
                                    if (i === 0) {
                                        await messaging.editMessage(chatId, messageId, parts[i]);
                                    } else {
                                        try {
                                            const tgClient = core.get('telegram').getClient();
                                            if (tgClient) await tgClient.sendMessage(chatId, { message: parts[i] });
                                        } catch {
                                            // ignore
                                        }
                                    }
                                }
                            } else {
                                await messaging.editMessage(chatId, messageId, responseText);
                            }
                            break;
                        }

                        case 'список':
                        case 'list':
                        case 'ls': {
                            const dirRel = subArgs[0] || '.';
                            const targetDir = utils.resolveBotPath(dirRel);
                            if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
                                throw new Error(`Директория не найдена: ${dirRel}`);
                            }
                            const entries = fs.readdirSync(targetDir, { withFileTypes: true });
                            const visible = entries.filter(e => !utils.isSecretName(e.name) && !utils.isSecretPath(path.join(targetDir, e.name)));
                            let out = `📁 Содержимое папки "${dirRel}":\n\n`;
                            visible.forEach(e => {
                                const icon = e.isDirectory() ? '📁' : '📄';
                                out += `${icon} ${e.name}\n`;
                            });
                            await messaging.editMessage(chatId, messageId, out);
                            break;
                        }

                        case 'инфо':
                        case 'info': {
                            if (subArgs.length === 0) throw new Error('Укажите путь к файлу');
                            const targetPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(targetPath)) throw new Error('Доступ запрещен');
                            if (!fs.existsSync(targetPath)) throw new Error(`Файл не существует: ${subArgs[0]}`);
                            const stats = fs.statSync(targetPath);
                            const info = `📊 Информация о "${subArgs[0]}":\n\n` +
                                `• Тип: ${stats.isDirectory() ? 'Директория' : 'Файл'}\n` +
                                `• Размер: ${stats.size} байт\n` +
                                `• Изменен: ${stats.mtime.toLocaleString('ru-RU')}\n` +
                                `• Создан: ${stats.birthtime.toLocaleString('ru-RU')}`;
                            await messaging.editMessage(chatId, messageId, info);
                            break;
                        }

                        case 'бэкап':
                        case 'backup': {
                            if (subArgs.length === 0) throw new Error('Укажите файл для создания бэкапа');
                            const srcPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(srcPath)) throw new Error('Бэкап секретных файлов запрещен');
                            if (!fs.existsSync(srcPath)) throw new Error('Файл не существует');
                            const backupsDir = (utils.paths && utils.paths.BACKUPS_DIR) || path.join(process.cwd(), 'backups');
                            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
                            const filename = path.basename(srcPath);
                            const backupFilename = `${filename}_${Date.now()}.backup`;
                            const destPath = path.join(backupsDir, backupFilename);
                            fs.copyFileSync(srcPath, destPath);
                            await messaging.editMessage(chatId, messageId, `✅ Бэкап создан: ${backupFilename}`);
                            break;
                        }

                        case 'восстановить':
                        case 'restore': {
                            if (subArgs.length < 2) throw new Error('Формат: восстановить [файл] [имя_бэкапа]');
                            const targetPath = utils.resolveRestore(subArgs[0], subArgs[1]);
                            const backupsDir = (utils.paths && utils.paths.BACKUPS_DIR) || path.join(process.cwd(), 'backups');
                            const backupPath = path.join(backupsDir, subArgs[1]);
                            if (!fs.existsSync(backupPath)) throw new Error(`Бэкап не найден: ${subArgs[1]}`);
                            fs.copyFileSync(backupPath, targetPath);
                            await messaging.editMessage(chatId, messageId, `✅ Файл "${subArgs[0]}" успешно восстановлен из бэкапа`);
                            break;
                        }

                        case 'удалить':
                        case 'delete':
                        case 'del': {
                            if (subArgs.length === 0) throw new Error('Укажите файл для удаления');
                            const targetPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(targetPath)) throw new Error('Удаление запрещенных файлов заблокировано');
                            if (!fs.existsSync(targetPath)) throw new Error('Файл не найден');
                            fs.unlinkSync(targetPath);
                            await messaging.editMessage(chatId, messageId, `🗑️ Файл "${subArgs[0]}" удален`);
                            break;
                        }

                        case 'создать':
                        case 'create':
                        case 'new': {
                            if (subArgs.length === 0) throw new Error('Укажите имя файла');
                            const targetPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(targetPath)) throw new Error('Создание данного файла запрещено');
                            const newContent = extractReplyCode(message) || subArgs.slice(1).join(' ') || '';
                            fs.writeFileSync(targetPath, newContent, 'utf8');
                            await messaging.editMessage(chatId, messageId, `✅ Файл "${subArgs[0]}" создан (${Buffer.byteLength(newContent)} байт)`);
                            break;
                        }

                        case 'редактировать':
                        case 'edit': {
                            if (subArgs.length === 0) throw new Error('Укажите имя файла');
                            const targetPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(targetPath)) throw new Error('Редактирование запрещено');
                            if (!fs.existsSync(targetPath)) throw new Error('Файл не существует');
                            const editContent = extractReplyCode(message) || subArgs.slice(1).join(' ');
                            if (!editContent) throw new Error('Ответьте на сообщение с новым кодом файла');
                            fs.writeFileSync(targetPath, editContent, 'utf8');
                            await messaging.editMessage(chatId, messageId, `✅ Файл "${subArgs[0]}" перезаписан (${Buffer.byteLength(editContent)} байт)`);
                            break;
                        }

                        case 'добавить':
                        case 'add': {
                            if (subArgs.length === 0) throw new Error('Укажите имя файла');
                            const targetPath = utils.resolveBotPath(subArgs[0]);
                            if (utils.isSecretPath(targetPath)) throw new Error('Редактирование запрещено');
                            if (!fs.existsSync(targetPath)) throw new Error('Файл не существует');
                            const addContent = extractReplyCode(message) || subArgs.slice(1).join(' ');
                            if (!addContent) throw new Error('Ответьте на сообщение с кодом для добавления');
                            fs.appendFileSync(targetPath, '\n' + addContent, 'utf8');
                            await messaging.editMessage(chatId, messageId, `✅ Код добавлен в конец файла "${subArgs[0]}"`);
                            break;
                        }

                        case 'перезагрузка':
                        case 'reload':
                        case 'restart': {
                            await messaging.editMessage(chatId, messageId, '🔄 Перезагрузка бота...');
                            setTimeout(() => {
                                processService.gracefulShutdown(0, 'Code restart command');
                            }, 500);
                            break;
                        }

                        default:
                            await messaging.editMessage(chatId, messageId,
                                '❌ Неизвестная подкоманда. Используйте помощь для списка команд.'
                            );
                    }
                } catch (error) {
                    await messaging.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
                }
            }
        }
    },

    async init(core) {
        core.log('code', 'Code management module initialized');
    },

    async stop(core) {
        core.log('code', 'Code management module stopped');
    }
};
