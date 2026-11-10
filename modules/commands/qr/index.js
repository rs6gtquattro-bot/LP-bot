const fs = require('fs');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');

let coreInstance = null;

async function executeQR(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const telegram = core.get('telegram');

    if (!args || args.length === 0) {
        await messaging.editMessage(chatId, messageId, `📱 Использование: ${settings.prefix}qr [текст]`);
        return;
    }

    const text = args.join(' ');
    const tempFilePath = path.join(os.tmpdir(), `temp_qr_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

    try {
        await qrcode.toFile(tempFilePath, text, {
            width: 300,
            height: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        if (telegram.client) {
            await telegram.client.sendMessage(chatId, {
                file: tempFilePath,
                message: `📱 QR-код для: ${text}`,
                parseMode: null
            });
        }

        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch {}

        try {
            await messaging.safeDelete(chatId, messageId);
        } catch {}
    } catch (error) {
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch {}
        await messaging.editMessage(chatId, messageId, `❌ Ошибка генерации QR-кода: ${error.message}`);
    }
}

module.exports = {
    name: 'qr',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'telegram'],
    commands: {
        qr: {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeQR(c, ctx);
            },
            help: 'Генерация QR-кода',
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
