const axios = require('axios');

/**
 * DeepSeek AI Integration Module
 * Commands: дип (deepseek), дип_ключ, дип_статус, дип_помощь
 */

async function callDeepSeekAPI(prompt, config) {
    const url = 'https://api.deepseek.com/v1/chat/completions';
    const requestData = {
        model: config.model || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: config.maxTokens || 2048,
        temperature: config.temperature !== undefined ? config.temperature : 0.7,
        stream: false
    };

    const response = await axios.post(url, requestData, {
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
        return response.data.choices[0].message.content.trim();
    }
    throw new Error('Неверный формат ответа от DeepSeek API');
}

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

function getDeepSeekConfig(settingsService) {
    const defaultConf = {
        apiKey: '',
        model: 'deepseek-chat',
        maxTokens: 2048,
        temperature: 0.7,
        enabled: false
    };
    const current = settingsService.get('deepseek', null);
    if (!current || typeof current !== 'object') {
        return defaultConf;
    }
    return Object.assign({}, defaultConf, current);
}

module.exports = {
    name: 'deepseek',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings'],

    commands: {
        'дип': {
            aliases: ['deepseek'],
            help: 'Запрос к DeepSeek AI нейросети',
            async handler(core, context, ...rest) {
                const { args, chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const prefix = settings.get('prefix', '.');
                const dsConfig = getDeepSeekConfig(settings);

                if (!dsConfig.apiKey) {
                    await messaging.editMessage(chatId, messageId,
                        `🤖 DeepSeek AI Integration\n\n` +
                        `🔑 Для использования необходим API ключ:\n` +
                        `• ${prefix}дип_ключ ваш_api_ключ\n\n` +
                        `🔗 Получить ключ:\n` +
                        `1. Зайдите на https://platform.deepseek.com\n` +
                        `2. Зарегистрируйтесь/войдите\n` +
                        `3. Перейдите в API Keys\n` +
                        `4. Создайте новый ключ\n` +
                        `5. Скопируйте ключ (начинается с sk-)\n\n` +
                        `💡 Пример:\n` +
                        `${prefix}дип_ключ sk-вашключ123456789`
                    );
                    return;
                }

                if (args.length === 0) {
                    await messaging.editMessage(chatId, messageId,
                        `💬 DeepSeek AI Чат\n\n` +
                        `Отправьте ваш запрос:\n` +
                        `• ${prefix}дип Привет! Как дела?\n` +
                        `• ${prefix}дип Напиши код на Python\n` +
                        `• ${prefix}дип Объясни квантовую физику\n\n` +
                        `⚡ Используется: ${dsConfig.model}`
                    );
                    return;
                }

                const query = args.join(' ');
                try {
                    await messaging.editMessage(chatId, messageId, `🔄 DeepSeek обрабатывает запрос...`);
                    const answer = await callDeepSeekAPI(query, dsConfig);
                    const formatted = `🤖 DeepSeek Response:\n\n${answer}`;

                    if (formatted.length > 4000) {
                        const parts = messaging.splitMessage(formatted, 4000);
                        let telegramClient = null;
                        try {
                            const tgService = core.get('telegram');
                            telegramClient = tgService ? tgService.getClient() : null;
                        } catch {
                            // telegram optional
                        }

                        for (let i = 0; i < parts.length; i++) {
                            if (i === 0) {
                                await messaging.editMessage(chatId, messageId, parts[i]);
                            } else if (telegramClient && typeof telegramClient.sendMessage === 'function') {
                                await telegramClient.sendMessage(chatId, {
                                    message: parts[i],
                                    parseMode: null
                                });
                            }
                        }
                    } else {
                        await messaging.editMessage(chatId, messageId, formatted);
                    }
                } catch (error) {
                    let errorMsg = `❌ Ошибка DeepSeek: ${error.message}`;
                    const msg = String(error.message || '');
                    if (msg.includes('401')) {
                        errorMsg = `❌ Неверный API ключ\n\nПроверьте ключ: ${prefix}дип_ключ [новый_ключ]`;
                    } else if (msg.includes('402')) {
                        errorMsg = `❌ Недостаточно средств\n\nПополните баланс на platform.deepseek.com`;
                    } else if (msg.includes('429')) {
                        errorMsg = `❌ Слишком много запросов\n\nПодождите немного перед следующим запросом`;
                    } else if (msg.includes('ENOTFOUND')) {
                        errorMsg = `❌ Проблемы с интернет-соединением\n\nПроверьте подключение к интернету`;
                    }
                    await messaging.editMessage(chatId, messageId, errorMsg);
                }
            }
        },

        'дип_ключ': {
            aliases: [],
            help: 'Установка DeepSeek API ключа',
            async handler(core, context, ...rest) {
                const { args, chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const prefix = settings.get('prefix', '.');

                if (args.length === 0) {
                    await messaging.editMessage(chatId, messageId,
                        `🔑 Установка DeepSeek API ключа\n\n` +
                        `💡 Использование: ${prefix}дип_ключ ваш_api_ключ\n\n` +
                        `🔗 Получить ключ:\n` +
                        `https://platform.deepseek.com/api_keys\n\n` +
                        `📝 Ключ должен начинаться с "sk-"`
                    );
                    return;
                }

                const apiKey = args[0].trim();
                if (!apiKey.startsWith('sk-')) {
                    await messaging.editMessage(chatId, messageId,
                        `❌ Неверный формат API ключа\n\n` +
                        `💡 Ключ должен начинаться с "sk-"`
                    );
                    return;
                }

                const dsConfig = getDeepSeekConfig(settings);
                dsConfig.apiKey = apiKey;
                dsConfig.enabled = true;
                settings.set('deepseek', dsConfig);

                await messaging.editMessage(chatId, messageId,
                    `✅ API ключ сохранен!\n\n` +
                    `🔑 Ключ: ${apiKey.substring(0, 10)}...\n` +
                    `🤖 Модель: ${dsConfig.model}\n\n` +
                    `💡 Теперь используйте: ${prefix}дип [ваш запрос]\n\n` +
                    `⚠️ Ключ будет проверен при первом запросе`
                );
            }
        },

        'дип_статус': {
            aliases: [],
            help: 'Статус интеграции DeepSeek AI',
            async handler(core, context, ...rest) {
                const { chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const prefix = settings.get('prefix', '.');
                const dsConfig = getDeepSeekConfig(settings);

                const status = dsConfig.enabled ? '✅ Активен' : '❌ Неактивен';
                const apiKeyStatus = dsConfig.apiKey ?
                    `🔑 ${dsConfig.apiKey.substring(0, 10)}...` : '❌ Не установлен';

                const response = `📊 Статус DeepSeek\n\n` +
                    `• Статус: ${status}\n` +
                    `• API ключ: ${apiKeyStatus}\n` +
                    `• Модель: ${dsConfig.model}\n` +
                    `• Макс. токенов: ${dsConfig.maxTokens}\n` +
                    `• Температура: ${dsConfig.temperature}\n\n` +
                    `💡 Команды:\n` +
                    `• ${prefix}дип [запрос] - общение с AI\n` +
                    `• ${prefix}дип_ключ [ключ] - установить ключ\n` +
                    `• ${prefix}дип_помощь - подробная помощь`;

                await messaging.editMessage(chatId, messageId, response);
            }
        },

        'дип_помощь': {
            aliases: [],
            help: 'Подробная помощь по DeepSeek AI',
            async handler(core, context, ...rest) {
                const { chatId, messageId } = parseContext(core, context, ...rest);
                const messaging = core.get('messaging');
                const settings = core.get('settings');
                const prefix = settings.get('prefix', '.');

                const helpText = `🤖 DeepSeek AI - Помощь\n\n` +
                    `🔑 ПОЛУЧЕНИЕ API КЛЮЧА:\n` +
                    `1. Откройте: https://platform.deepseek.com\n` +
                    `2. Войдите или зарегистрируйтесь\n` +
                    `3. Перейдите в "API Keys"\n` +
                    `4. Нажмите "Create new API key"\n` +
                    `5. Скопируйте ключ (начинается с sk-)\n\n` +
                    `⚙️ НАСТРОЙКА БОТА:\n` +
                    `• ${prefix}дип_ключ sk-ваш_ключ - установить ключ\n` +
                    `• ${prefix}дип_статус - проверить статус\n\n` +
                    `💬 ИСПОЛЬЗОВАНИЕ AI:\n` +
                    `• ${prefix}дип [вопрос] - задать вопрос\n` +
                    `• ${prefix}дип напиши код на Python\n` +
                    `• ${prefix}дип объясни квантовую физику\n\n` +
                    `❓ РЕШЕНИЕ ПРОБЛЕМ:\n` +
                    `• Ошибка 401: Неверный API ключ\n` +
                    `• Ошибка 402: Закончились средства\n` +
                    `• Ошибка 429: Слишком много запросов\n` +
                    `• ENOTFOUND: Проверьте интернет-соединение`;

                await messaging.editMessage(chatId, messageId, helpText);
            }
        }
    },

    async init(core) {
        core.log('deepseek', 'DeepSeek module initialized');
    },

    async stop(core) {
        core.log('deepseek', 'DeepSeek module stopped');
    }
};
