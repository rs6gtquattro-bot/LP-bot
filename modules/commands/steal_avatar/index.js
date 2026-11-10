const fs = require('fs');
const os = require('os');
const path = require('path');
const { Api } = require('telegram');

let coreInstance = null;

async function executeStealAvatar(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        if (!args || args.length === 0) {
            await messaging.editMessage(chatId, messageId, `👤 Использование: ${settings.prefix}кража_авы [юзернейм]`);
            return;
        }

        const username = args[0].replace('@', '');
        await messaging.editMessage(chatId, messageId, `🔍 Ищу @${username}...`);

        const user = await client.getEntity(username);
        if (!user) {
            await messaging.editMessage(chatId, messageId, `❌ Пользователь не найден`);
            return;
        }

        await messaging.editMessage(chatId, messageId, `📥 Получаю информацию...`);
        const fullUser = await client.invoke(
            new Api.users.GetFullUser({
                id: user
            })
        );

        if (!fullUser.profilePhoto) {
            await messaging.editMessage(chatId, messageId, `❌ У пользователя нет аватара`);
            return;
        }

        await messaging.editMessage(chatId, messageId, `📤 Устанавливаю аватар...`);

        // Метод 1: Прямое использование InputPhoto из профиля
        try {
            await client.invoke(
                new Api.photos.UploadProfilePhoto({
                    file: new Api.InputPhoto({
                        id: fullUser.profilePhoto.id,
                        accessHash: fullUser.profilePhoto.accessHash,
                        fileReference: fullUser.profilePhoto.fileReference
                    })
                })
            );
            await messaging.editMessage(chatId, messageId, `✅ Аватар @${username} установлен!`);
            return;
        } catch {}

        // Метод 2: Используем photos.GetUserPhotos
        await messaging.editMessage(chatId, messageId, `🔄 Пробую другой метод...`);
        try {
            const photos = await client.invoke(
                new Api.photos.GetUserPhotos({
                    userId: user,
                    offset: 0,
                    maxId: 0,
                    limit: 1
                })
            );

            if (photos.photos && photos.photos.length > 0) {
                const photo = photos.photos[0];
                await client.invoke(
                    new Api.photos.UploadProfilePhoto({
                        id: photo.id,
                        file: new Api.InputPhoto({
                            id: photo.id,
                            accessHash: photo.accessHash,
                            fileReference: photo.fileReference
                        })
                    })
                );
                await messaging.editMessage(chatId, messageId, `✅ Аватар @${username} установлен!`);
                return;
            }
        } catch {}

        // Метод 3: Создаем временный файл и загружаем через него
        await messaging.editMessage(chatId, messageId, `⚡ Пробую загрузку через файл...`);
        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `avatar_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);

        try {
            const photoBuffer = await client.downloadProfilePhoto(user, { isBig: true });
            if (photoBuffer) {
                fs.writeFileSync(tempFile, photoBuffer);
                const file = await client.uploadFile({
                    file: tempFile,
                    workers: 1
                });
                await client.invoke(
                    new Api.photos.UploadProfilePhoto({
                        file: file
                    })
                );
                try {
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                } catch {}

                await messaging.editMessage(chatId, messageId, `✅ Аватар @${username} установлен!`);
                return;
            }
        } catch {
            try {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch {}
        }

        throw new Error('Все методы не сработали');
    } catch (error) {
        let errorMsg = `❌ Ошибка: ${error.message}`;
        if (error.message.includes('FILE_PARTS_INVALID')) {
            errorMsg = `❌ Проблема с загрузкой файла. Попробуйте другого пользователя.`;
        } else if (error.message.includes('PHOTO_INVALID')) {
            errorMsg = `❌ Неподдерживаемый формат изображения.`;
        }
        await messaging.editMessage(chatId, messageId, errorMsg);
    }
}

module.exports = {
    name: 'steal_avatar',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'settings', 'telegram'],
    commands: {
        'кража_авы': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeStealAvatar(c, ctx);
            },
            help: 'Скопировать аватар пользователя',
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
