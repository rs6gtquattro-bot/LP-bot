const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const Jimp = require('jimp');

let coreInstance = null;

function getImageType(buffer) {
    if (!buffer || buffer.length < 8) return 'unknown';
    const header = buffer.slice(0, 8);
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return 'png';
    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return 'jpeg';
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return 'gif';
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) return 'webp';
    return 'unknown';
}

async function downloadMediaToBuffer(client, mediaMessage) {
    const buffer = await client.downloadMedia(mediaMessage, { output: 'buffer' });
    if (!buffer || buffer.length === 0) throw new Error('Получен пустой буфер');
    return buffer;
}

async function executeScanQR(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        let targetMessage = message;

        if (message.replyTo && message.replyTo.replyToMsgId && client) {
            const repliedMessages = await client.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });
            if (repliedMessages[0] && (repliedMessages[0].photo || repliedMessages[0].media)) {
                targetMessage = repliedMessages[0];
            } else {
                await messaging.editMessage(chatId, messageId, `❌ В сообщении, на которое вы ответили, нет изображения`);
                return;
            }
        }

        if (!targetMessage.media && !targetMessage.photo) {
            await messaging.editMessage(
                chatId,
                messageId,
                `📷 Отправьте фото с QR-кодом или ответьте командой на сообщение с фото\n\n` +
                `💡 Пример использования:\n` +
                `1. Отправьте фото с QR-кодом в чат\n` +
                `2. Ответьте на это фото командой: ${settings.prefix}чек_qr`
            );
            return;
        }

        await messaging.editMessage(chatId, messageId, `🔍 Сканирую QR-код...`);

        let buffer;
        try {
            if (!client) throw new Error('Telegram клиент недоступен');
            buffer = await downloadMediaToBuffer(client, targetMessage);
        } catch (downloadError) {
            await messaging.editMessage(
                chatId,
                messageId,
                `❌ Не удалось загрузить изображение\n\n` +
                `💡 Возможные причины:\n` +
                `• Изображение слишком большое\n` +
                `• Формат не поддерживается\n` +
                `• Проблемы с подключением`
            );
            return;
        }

        try {
            const imageType = getImageType(buffer);
            if (imageType === 'unknown') {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `❌ Неизвестный формат изображения\n\n` +
                    `💡 Поддерживаемые форматы: PNG, JPEG, GIF, WebP\n` +
                    `📝 Попробуйте конвертировать изображение в PNG`
                );
                return;
            }

            let imageData;
            if (imageType === 'png') {
                const png = PNG.sync.read(buffer);
                imageData = {
                    data: new Uint8ClampedArray(png.data),
                    width: png.width,
                    height: png.height
                };
            } else {
                try {
                    const image = await Jimp.read(buffer);
                    image.resize(800, Jimp.AUTO);
                    const pngBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
                    const png = PNG.sync.read(pngBuffer);
                    imageData = {
                        data: new Uint8ClampedArray(png.data),
                        width: png.width,
                        height: png.height
                    };
                } catch (jimpError) {
                    throw new Error(`Не удалось обработать ${imageType} изображение`);
                }
            }

            const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
            if (qrCode) {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `✅ QR-код распознан!\n\n` +
                    `📝 Содержимое:\n` +
                    `\`\`\`\n${qrCode.data}\n\`\`\`\n` +
                    `📍 Расположение: X=${qrCode.location.topLeftCorner.x}, Y=${qrCode.location.topLeftCorner.y}`
                );
            } else {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `❌ QR-код не найден на изображении\n\n` +
                    `💡 Советы по улучшению распознавания:\n` +
                    `• Убедитесь, что QR-код четкий и не размытый\n` +
                    `• Избегайте искажений и бликов на фото\n` +
                    `• Убедитесь, что весь QR-код виден в кадре\n` +
                    `• Используйте изображения в формате PNG`
                );
            }
        } catch (decodeError) {
            if (decodeError.message.includes('unrecognised content at end of stream')) {
                await messaging.editMessage(
                    chatId,
                    messageId,
                    `❌ Ошибка: изображение повреждено или имеет неверный формат\n\n` +
                    `💡 Попробуйте:\n` +
                    `• Пересохранить изображение как PNG\n` +
                    `• Использовать другое изображение QR-кода\n` +
                    `• Убедиться, что файл не поврежден`
                );
            } else {
                await messaging.editMessage(chatId, messageId, `❌ Ошибка обработки изображения: ${decodeError.message}`);
            }
        }
    } catch (error) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка сканирования: ${error.message}`);
    }
}

module.exports = {
    name: 'check_qr',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'telegram'],
    commands: {
        'чек_qr': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeScanQR(c, ctx);
            },
            help: 'Сканирование QR-кода (ответом на фото)',
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
