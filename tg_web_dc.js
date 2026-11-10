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

function parseTelegramProxy(proxyConfig) {
    if (!proxyConfig) return null;
    if (typeof proxyConfig === 'object') {
        if (proxyConfig.ip && proxyConfig.port) {
            return {
                ip: String(proxyConfig.ip),
                port: Number(proxyConfig.port),
                socksType: Number(proxyConfig.socksType) || 5,
                username: proxyConfig.username || undefined,
                password: proxyConfig.password || undefined,
                timeout: Number(proxyConfig.timeout) || 10,
                MTProxy: proxyConfig.MTProxy || undefined,
                secret: proxyConfig.secret || undefined
            };
        }
        return null;
    }
    if (typeof proxyConfig === 'string') {
        const trimmed = proxyConfig.trim();
        if (!trimmed) return null;
        try {
            const parsed = new URL(trimmed);
            const isSocks = parsed.protocol.startsWith('socks');
            const socksType = parsed.protocol.includes('4') ? 4 : 5;
            return {
                ip: parsed.hostname,
                port: Number(parsed.port) || (isSocks ? 1080 : 8080),
                socksType: isSocks ? socksType : 5,
                username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
                password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
                timeout: 10
            };
        } catch {
            const parts = trimmed.split(':');
            if (parts.length >= 2) {
                return {
                    ip: parts[0],
                    port: Number(parts[1]),
                    socksType: 5,
                    timeout: 10
                };
            }
        }
    }
    return null;
}

module.exports = { useWebTelegramDCs, webClientParams, DEFAULT_DC_ID, parseTelegramProxy };
