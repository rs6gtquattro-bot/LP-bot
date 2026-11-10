/**
 * Delete Messages Module
 * Command: смс (удаление сообщений через messaging.safeDelete)
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

module.exports = {
    name: 'delete_messages',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram'],

    commands: {
        'смс': {
            aliases: [],
            help: 'Удаление сообщений (по ответу или количество)',
            async handler(core, context, ...rest) {
                const { args, message, chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const telegramService = core.get('telegram');
                const client = telegramService.getClient();

                try {
                    const messagesToDelete = [];
                    if (messageId) {
                        messagesToDelete.push(messageId);
                    }

                    // Если есть ответ на сообщение
                    if (message && message.replyTo && message.replyTo.replyToMsgId) {
                        const repliedMessageId = message.replyTo.replyToMsgId;
                        messagesToDelete.push(repliedMessageId);

                        // Если указано количество дополнительных сообщений
                        if (args.length > 0) {
                            const additionalCount = parseInt(args[0], 10);
                            if (!isNaN(additionalCount) && additionalCount > 0 && client && typeof client.getMessages === 'function') {
                                const messages = await client.getMessages(chatId, {
                                    limit: additionalCount + 10
                                });

                                const repliedIndex = messages.findIndex(msg => msg.id === repliedMessageId);
                                if (repliedIndex !== -1) {
                                    const startIndex = Math.max(0, repliedIndex - additionalCount);
                                    const endIndex = repliedIndex;

                                    for (let i = startIndex; i < endIndex; i++) {
                                        if (messages[i].id !== messageId && !messagesToDelete.includes(messages[i].id)) {
                                            messagesToDelete.push(messages[i].id);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // Если нет ответа, но указано количество
                    else if (args.length > 0) {
                        const count = parseInt(args[0], 10);
                        if (!isNaN(count) && count > 0 && client && typeof client.getMessages === 'function') {
                            const messages = await client.getMessages(chatId, {
                                limit: count + 1
                            });

                            for (let i = 0; i < Math.min(messages.length, count); i++) {
                                if (messages[i].id !== messageId && !messagesToDelete.includes(messages[i].id)) {
                                    messagesToDelete.push(messages[i].id);
                                }
                            }
                        }
                    }

                    // Удаляем сообщения через безопасную службу safeDelete
                    if (messagesToDelete.length > 0) {
                        await messaging.safeDelete(chatId, messagesToDelete, { revoke: true });

                        // Временное уведомление при пачке сообщений
                        if (messagesToDelete.length > 1 && client && typeof client.sendMessage === 'function') {
                            try {
                                const notification = await client.sendMessage(chatId, {
                                    message: `✅ Удалено ${messagesToDelete.length} сообщений`
                                });

                                if (notification && notification.id) {
                                    setTimeout(async () => {
                                        try {
                                            await messaging.safeDelete(chatId, [notification.id], { revoke: true });
                                        } catch {
                                            // Игнорируем ошибки подчистки уведомления
                                        }
                                    }, 3000);
                                }
                            } catch (e) {
                                core.log('delete_messages', `Notification failed: ${e.message}`);
                            }
                        }
                    }
                } catch (error) {
                    core.log('delete_messages', `Delete error: ${error.message}`);
                }
            }
        }
    },

    async init(core) {
        core.log('delete_messages', 'delete_messages module initialized');
    },

    async stop(core) {
        core.log('delete_messages', 'delete_messages module stopped');
    }
};
