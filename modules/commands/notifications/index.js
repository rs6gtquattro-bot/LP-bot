const { Api } = require('telegram');

let coreInstance = null;

async function executeToggleNotifications(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const telegram = core.get('telegram');
    const client = telegram.client;

    try {
        if (!client) {
            throw new Error('Telegram клиент не подключен');
        }

        const chat = await client.getEntity(chatId);
        const isMuted = await client.isMuted(chat);

        if (isMuted) {
            await client.unmuteChat(chat);
            await messaging.editMessage(chatId, messageId, '🔔 Уведомления в этом чате ВКЛЮЧЕНЫ');
        } else {
            await client.muteChat(chat);
            await messaging.editMessage(chatId, messageId, '🔕 Уведомления в этом чате ВЫКЛЮЧЕНЫ');
        }
    } catch (error) {
        try {
            const peer = await client.getInputEntity(chatId);
            const currentSettings = await client.invoke(
                new Api.account.GetNotifySettings({ peer })
            );

            const isMuted = currentSettings.muteUntil && currentSettings.muteUntil > 0;

            if (isMuted) {
                await client.invoke(
                    new Api.account.UpdateNotifySettings({
                        peer,
                        settings: new Api.InputPeerNotifySettings({
                            showPreviews: true,
                            silent: false,
                            muteUntil: 0,
                            sound: new Api.NotificationSoundDefault()
                        })
                    })
                );
                await messaging.editMessage(chatId, messageId, '🔔 Уведомления в этом чате ВКЛЮЧЕНЫ');
            } else {
                await client.invoke(
                    new Api.account.UpdateNotifySettings({
                        peer,
                        settings: new Api.InputPeerNotifySettings({
                            showPreviews: false,
                            silent: true,
                            muteUntil: 2147483647,
                            sound: new Api.NotificationSoundNone()
                        })
                    })
                );
                await messaging.editMessage(chatId, messageId, '🔕 Уведомления в этом чате ВЫКЛЮЧЕНЫ');
            }
        } catch {
            await messaging.editMessage(chatId, messageId, `❌ Ошибка переключения уведомлений: ${error.message}`);
        }
    }
}

module.exports = {
    name: 'notifications',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'telegram'],
    commands: {
        'уведы': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeToggleNotifications(c, ctx);
            },
            help: 'Включить/выключить уведомления чата',
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
