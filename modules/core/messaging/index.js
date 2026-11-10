const { Api } = require('telegram');

class MessagingService {
    constructor(telegramService, core) {
        this.telegram = telegramService;
        this.core = core;
    }

    get client() {
        return this.telegram ? this.telegram.client : null;
    }

    async editMessage(chatId, messageId, newText) {
        const client = this.client;
        if (!client) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('messaging', `[Offline] editMessage: ${newText}`);
            }
            return null;
        }

        const chatIdValue = chatId && chatId.value ? chatId.value : chatId;
        const chatIdNum = Number(chatIdValue);
        const messageIdNum = Number(messageId);

        if (isNaN(chatIdNum) || isNaN(messageIdNum)) {
            // Если параметры невалидны, пробуем отправить новое
            try {
                return await client.sendMessage(chatIdNum, { message: newText, parseMode: null });
            } catch (e) {
                return null;
            }
        }

        try {
            return await client.editMessage(chatIdNum, {
                message: messageIdNum,
                text: newText,
                parseMode: null
            });
        } catch (error) {
            // Запасной вариант: отправка нового сообщения
            try {
                return await client.sendMessage(chatIdNum, {
                    message: newText,
                    parseMode: null
                });
            } catch (sendErr) {
                if (this.core && typeof this.core.log === 'function') {
                    this.core.log('messaging', `Ошибка editMessage: ${sendErr.message}`);
                }
                return null;
            }
        }
    }

    async safeDelete(chatId, messageId) {
        const client = this.client;
        if (!client) return false;

        const chatIdNum = Number(chatId && chatId.value ? chatId.value : chatId);
        const messageIdNum = Number(messageId);

        if (!chatIdNum || isNaN(chatIdNum) || !messageIdNum || isNaN(messageIdNum)) {
            return false;
        }

        // Метод 1: Прямое удаление
        try {
            await client.deleteMessages(chatIdNum, [messageIdNum]);
            return true;
        } catch {}

        // Метод 2: Через вызов Api.messages.DeleteMessages с revoke: true
        try {
            await client.invoke(new Api.messages.DeleteMessages({
                id: [messageIdNum],
                revoke: true
            }));
            return true;
        } catch {}

        // Метод 3: Для каналов и супергрупп
        try {
            const entity = await client.getInputEntity(chatIdNum);
            if (entity instanceof Api.InputPeerChannel) {
                await client.invoke(new Api.channels.DeleteMessages({
                    channel: entity,
                    id: [messageIdNum]
                }));
                return true;
            }
        } catch {}

        // Метод 4: Редактирование в точку, затем удаление
        try {
            await client.editMessage(chatIdNum, {
                message: messageIdNum,
                text: '.',
                parseMode: null
            });
            await client.deleteMessages(chatIdNum, [messageIdNum]);
            return true;
        } catch {}

        return false;
    }

    splitMessage(text, maxLength = 4000) {
        if (!text) return [];
        if (text.length <= maxLength) return [text];

        const parts = [];
        let currentPart = '';
        const sentences = text.split(/(?<=[.!?\n])\s+/);

        for (const sentence of sentences) {
            if ((currentPart.length + sentence.length) <= maxLength) {
                currentPart += (currentPart ? ' ' : '') + sentence;
            } else {
                if (currentPart) parts.push(currentPart.trim());
                if (sentence.length > maxLength) {
                    // Если отдельное предложение превышает maxLength, делим посимвольно
                    let remaining = sentence;
                    while (remaining.length > 0) {
                        parts.push(remaining.slice(0, maxLength));
                        remaining = remaining.slice(maxLength);
                    }
                    currentPart = '';
                } else {
                    currentPart = sentence;
                }
            }
        }

        if (currentPart) {
            parts.push(currentPart.trim());
        }

        return parts;
    }

    async sendMessage(chatId, text, options = {}) {
        const client = this.client;
        if (!client) return null;

        const parts = this.splitMessage(text, 4000);
        const results = [];
        for (const part of parts) {
            const res = await client.sendMessage(chatId, {
                message: part,
                parseMode: options.parseMode !== undefined ? options.parseMode : null,
                ...options
            });
            results.push(res);
        }
        return results.length === 1 ? results[0] : results;
    }
}

module.exports = {
    name: 'messaging',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['telegram'],

    async init(core) {
        const tg = core.get('telegram');
        const service = new MessagingService(tg, core);
        core.provide('messaging', service);
        core.log('messaging', 'Служба messaging инициализирована');
    },

    async stop(core) {
        // Не требует очистки
    }
};
