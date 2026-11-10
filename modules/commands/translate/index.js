const axios = require('axios');

let coreInstance = null;

async function executeTranslate(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');

    let textToTranslate = (args && args.length > 0) ? args.join(' ') : '';

    if (!textToTranslate && message && message.replyTo && message.replyTo.replyToMsgId) {
        // Если текст не передан в аргументах, но есть реплай, пробуем взять текст реплая
        const telegram = core.get('telegram');
        if (telegram.client) {
            try {
                const msgs = await telegram.client.getMessages(chatId, { ids: [message.replyTo.replyToMsgId] });
                if (msgs[0] && msgs[0].text) {
                    textToTranslate = msgs[0].text;
                }
            } catch {}
        }
    }

    if (!textToTranslate) {
        await messaging.editMessage(
            chatId,
            messageId,
            `🌐 Использование: ${settings.prefix}перевод [английский текст]\n` +
            `Или ответьте на сообщение с английским текстом для перевода`
        );
        return;
    }

    try {
        await messaging.editMessage(chatId, messageId, `🔄 Перевод...`);

        // Метод 1: Google Translate single endpoint
        const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(textToTranslate)}`;
        const response = await axios.get(translateUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
            const translatedText = response.data[0][0][0];
            await messaging.editMessage(
                chatId,
                messageId,
                `🌐 Перевод:\n` +
                `🇺🇸 Английский: ${textToTranslate}\n` +
                `🇷🇺 Русский: ${translatedText}`
            );
            return;
        }

        throw new Error('Не удалось получить перевод');
    } catch {
        // Метод 2: Альтернативный endpoint Google
        try {
            const altUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ru&q=${encodeURIComponent(textToTranslate)}`;
            const altResponse = await axios.get(altUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (altResponse.data && altResponse.data.sentences && altResponse.data.sentences[0]) {
                const translatedText = altResponse.data.sentences[0].trans;
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `🌐 Перевод:\n` +
                    `🇺🇸 Английский: ${textToTranslate}\n` +
                    `🇷🇺 Русский: ${translatedText}`
                );
                return;
            }

            throw new Error('Альтернативный метод тоже не сработал');
        } catch {
            // Метод 3: MyMemory
            try {
                const simpleUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=en|ru`;
                const simpleResponse = await axios.get(simpleUrl, { timeout: 10000 });

                if (simpleResponse.data && simpleResponse.data.responseData && simpleResponse.data.responseData.translatedText) {
                    const translatedText = simpleResponse.data.responseData.translatedText;
                    await messaging.editMessage(
                        chatId,
                        messageId,
                        `🌐 Перевод (MyMemory):\n` +
                        `🇺🇸 Английский: ${textToTranslate}\n` +
                        `🇷🇺 Русский: ${translatedText}`
                    );
                    return;
                }

                throw new Error('Все методы перевода не сработали');
            } catch (finalError) {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `❌ Ошибка перевода: ${finalError.message}\n\n` +
                    `💡 Попробуйте:\n` +
                    `• Проверить подключение к интернету\n` +
                    `• Убедиться, что текст на английском\n` +
                    `• Попробовать позже`
                );
            }
        }
    }
}

module.exports = {
    name: 'translate',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],
    commands: {
        'перевод': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeTranslate(c, ctx);
            },
            help: 'Перевод текста на русский',
            aliases: []
        }
    },
    async init(core) {
        coreInstance = core;
    },
    async stop(core) {
        coreInstance = null;
    }
};
