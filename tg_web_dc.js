// Telegram только через WebSocket-вход *.web.telegram.org (как у веб-версии Telegram).
// С компьютера запуска соединения на голые IP дата-центров Telegram обрываются, а по web-именам проходят.
// Стартовый DC и все переходы между DC (смена DC при входе по номеру, экспортные отправители)
// идут по web-именам через getDC(..., web = true), порт 443. Голые IP не используются.
const { TelegramClient } = require('telegram');
const { PromisedWebSockets } = require('telegram/extensions');
const { ConnectionTCPObfuscated } = require('telegram/network');

const DEFAULT_DC_ID = 4; // как в gramJS

// Параметры клиента для WebSocket-входа
const webClientParams = { useWSS: true, networkSocket: PromisedWebSockets, connection: ConnectionTCPObfuscated };

function useWebTelegramDCs(client) {
    const origGetDC = TelegramClient.prototype.getDC;
    client.getDC = (dcId, downloadDC = false) => origGetDC.call(client, dcId, downloadDC, true);
    const origInitSession = client._initSession.bind(client);
    client._initSession = async () => {
        await origInitSession();
        const dc = await client.getDC(client.session.dcId || DEFAULT_DC_ID);
        if (client.session.serverAddress !== dc.ipAddress || client.session.port !== dc.port) {
            client.session.setDC(dc.id, dc.ipAddress, dc.port);
        }
    };
    return client;
}

module.exports = { useWebTelegramDCs, webClientParams, DEFAULT_DC_ID };
