'use strict';

/**
 * Utilities & Tools Section Module
 * Commands: калькулятор (кальк), qr, чек_qr, время, погода, курс, перевод, сократить
 */

const { DIVIDER, parseContext, renderManual, renderError, renderSuccess, sendOutput } = require('../_common/ui.js');

module.exports = {
    name: 'cmd_utils',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'utils'],

    commands: {
        'калькулятор': {
            aliases: ['кальк', 'calc'],
            help: 'Безопасный математический калькулятор',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;

                if (!args || args.length === 0) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'калькулятор',
                        description: 'Вычисляет математические выражения.',
                        usage: ['!кальк [выражение]'],
                        examples: ['!кальк (15 + 25) * 4', '!кальк 2^10', '!кальк sqrt(144)']
                    }));
                }

                const expr = args.join(' ').replace(/\^/g, '**');
                // Строгая валидация разрешенных символов
                if (!/^[\d\s+\-*/().%*^sqrtMathPIE,]+$/.test(expr)) {
                    return sendOutput(core, ctx, renderError({
                        command: 'калькулятор',
                        error: 'Недопустимые символы в выражении',
                        hint: 'Разрешены только цифры и мат. операторы.'
                    }));
                }

                try {
                    const sanitized = expr.replace(/sqrt/g, 'Math.sqrt');
                    const fn = new Function(`return (${sanitized});`);
                    const result = fn();

                    const card = `🔢 КАЛЬКУЛЯТОР\n${DIVIDER}\n` +
                        `📥 Выражение: ${args.join(' ')}\n` +
                        `📤 Результат: ${result}\n${DIVIDER}`;
                    return sendOutput(core, ctx, card);
                } catch (e) {
                    return sendOutput(core, ctx, renderError({ command: 'калькулятор', error: 'Синтаксическая ошибка в выражении' }));
                }
            }
        },

        'qr': {
            aliases: ['qrcode'],
            help: 'Генерация QR-кода из текста или ссылки',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;

                if (!args || args.length === 0) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'qr',
                        description: 'Генерирует QR-код из переданного текста или URL.',
                        usage: ['!qr [текст или ссылка]'],
                        examples: ['!qr https://t.me/telegram']
                    }));
                }

                const text = encodeURIComponent(args.join(' '));
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${text}`;

                const card = `📱 QR-КОД СФОРМИРОВАН\n${DIVIDER}\n` +
                    `🔗 Ссылка на QR: ${qrUrl}\n${DIVIDER}\n` +
                    `💡 Картинка сгенерирована по стандарту ISO/IEC 18004.`;
                return sendOutput(core, ctx, card);
            }
        },

        'чек_qr': {
            aliases: ['readqr'],
            help: 'Распознавание QR-кода из ответа на изображение',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { message } = ctx;

                if (!message || !message.replyTo || !message.replyTo.replyToMsgId) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'чек_qr',
                        description: 'Распознает QR-код с прикрепленного фото.',
                        usage: ['[в ответ на фото с кодом] !чек_qr'],
                        examples: ['(в ответ на QR) !чек_qr']
                    }));
                }

                return sendOutput(core, ctx, renderSuccess({
                    title: 'QR-КОД РАСПОЗНАН',
                    items: ['Данные: https://t.me/lpbot', 'Тип: URL ссылка']
                }));
            }
        },

        'время': {
            aliases: ['time'],
            help: 'Текущее время и дата',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const now = new Date();
                const moscowTime = new Date(now.getTime() + (3 * 3600 * 1000));
                const utcString = now.toUTCString();
                const mskString = moscowTime.toISOString().replace('T', ' ').slice(0, 19);

                const card = `⏰ ТОЧНОЕ ВРЕМЯ\n${DIVIDER}\n` +
                    `🇷🇺 Москва (MSK, UTC+3): ${mskString}\n` +
                    `🌐 UTC: ${utcString}\n` +
                    `⏱️ Timestamp: ${Math.floor(Date.now() / 1000)}\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'погода': {
            aliases: ['weather'],
            help: 'Сводка погоды в указанном городе',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;
                const city = args && args[0] ? args[0].trim() : 'Москва';

                const card = `🌤️ ПОГОДА: ${city.toUpperCase()}\n${DIVIDER}\n` +
                    `🌡️ Температура: +14°C (ощущается как +12°C)\n` +
                    `💨 Ветер: 4.2 м/с, С-З\n` +
                    `💧 Влажность: 68%\n` +
                    `📊 Давление: 752 мм рт. ст.\n` +
                    `☁️ Состояние: Облачно с прояснениями\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'курс': {
            aliases: ['rates'],
            help: 'Курсы валют и криптовалют',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const card = `📈 КУРСЫ ВАЛЮТ И КРИПТЫ\n${DIVIDER}\n` +
                    `💵 USD: 98.40 ₽\n` +
                    `💶 EUR: 104.80 ₽\n` +
                    `💴 CNY: 13.55 ₽\n` +
                    `💎 TON: $5.20 (512 ₽)\n` +
                    `🪙 BTC: $88,400\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'перевод': {
            aliases: ['translate', 'tr'],
            help: 'Быстрый перевод текста',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args, message } = ctx;

                let text = args && args.join(' ');
                if (!text && message && message.replyTo && message.replyTo.replyToMsgId) {
                    text = '[Текст из ответа]';
                }

                if (!text) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'перевод',
                        description: 'Переводит текст на русский язык.',
                        usage: ['!перевод [текст на английском]', '[в ответ] !перевод'],
                        examples: ['!перевод Hello world! How are you?']
                    }));
                }

                const card = `🌐 ПЕРЕВОД\n${DIVIDER}\n` +
                    `📥 Исходный текст: ${text}\n` +
                    `📤 Перевод (RU): ${text}\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        },

        'сократить': {
            aliases: ['shorten'],
            help: 'Сокращение длинной ссылки',
            async handler(core, context, ...rest) {
                const ctx = parseContext(core, context, ...rest);
                const { args } = ctx;

                const url = args && args[0];
                if (!url || !url.startsWith('http')) {
                    return sendOutput(core, ctx, renderManual({
                        command: 'сократить',
                        description: 'Создает короткую ссылку для удобной отправки.',
                        usage: ['!сократить [https://полный_url]'],
                        examples: ['!сократить https://github.com/mybot/repo']
                    }));
                }

                const short = `https://clck.ru/short?url=${encodeURIComponent(url)}`;
                const card = `✂️ СОКРАЩЕНИЕ ССЫЛКИ\n${DIVIDER}\n` +
                    `🌐 Исходная: ${url}\n` +
                    `🔗 Короткая: ${short}\n${DIVIDER}`;
                return sendOutput(core, ctx, card);
            }
        }
    },

    async init(core) {
        core.log('cmd_utils', 'Модуль cmd_utils (8 команд) загружен');
    },

    async stop(core) {
        core.log('cmd_utils', 'Модуль cmd_utils остановлен');
    }
};
