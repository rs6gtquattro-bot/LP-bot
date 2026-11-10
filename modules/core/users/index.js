class UsersService {
    constructor(db, core) {
        this.db = db;
        this.core = core;
    }

    normalizeTgId(tgId) {
        if (!tgId && tgId !== 0) return null;
        const clean = (typeof tgId === 'object' && tgId !== null)
            ? (tgId.userId || tgId.id || tgId.value || tgId)
            : tgId;
        const normalized = typeof clean === 'bigint' ? clean.toString() : String(clean);
        if (normalized === '[object Object]' || normalized === 'NaN' || normalized === 'undefined') {
            return null;
        }
        return normalized;
    }

    async ensureUserExists(tgId, username = null, firstName = null, lastName = null) {
        try {
            const normalizedId = this.normalizeTgId(tgId);
            if (!normalizedId) {
                if (this.core && typeof this.core.log === 'function') {
                    this.core.log('users', 'Предотвращена попытка вставки невалидного tg_id в users');
                }
                return null;
            }

            const existing = await this.getUserData(normalizedId);
            if (!existing) {
                await this.db.run(
                    `INSERT OR IGNORE INTO users (tg_id, username, first_name, last_name, access_level) VALUES (?, ?, ?, ?, 0)`,
                    [normalizedId, username, firstName, lastName]
                );
                return this.getUserData(normalizedId);
            }
            return existing;
        } catch (error) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('users', `Ошибка ensureUserExists: ${error.message}`);
            }
            return null;
        }
    }

    async getUserData(tgId) {
        const normalizedId = this.normalizeTgId(tgId);
        if (!normalizedId) return null;
        try {
            return await this.db.get('SELECT * FROM users WHERE tg_id = ?', [normalizedId]);
        } catch (e) {
            if (e.message && e.message.includes('no such table')) {
                return null;
            }
            throw e;
        }
    }

    async updateAccessLevel(tgId, level) {
        const normalizedId = this.normalizeTgId(tgId);
        if (!normalizedId) return false;
        const lvl = parseInt(level, 10);
        await this.db.run('UPDATE users SET access_level = ?, updated_at = CURRENT_TIMESTAMP WHERE tg_id = ?', [lvl, normalizedId]);
        return true;
    }

    isOwnerMessage(message, senderId, botInfo = null) {
        // Уровень 1: Прямой флаг исходящего сообщения аккаунта
        if (message && message.out) {
            return true;
        }

        // Уровень 2: Сверка senderId с ID авторизованного бота/владельца
        if (botInfo) {
            const ownId = (botInfo.id && botInfo.id.value)
                ? Number(botInfo.id.value)
                : Number(botInfo.id);
            const senderIdNum = (senderId && senderId.value)
                ? Number(senderId.value)
                : Number(senderId);

            if (ownId && senderIdNum && ownId === senderIdNum) {
                return true;
            }
        }

        // Уровень 3: Защитный барьер: любые внешние/входящие сообщения от несовпадающих ID отвергаются
        return false;
    }

    async getAccessLevel(senderId, botInfo = null) {
        if (this.isOwnerMessage(null, senderId, botInfo)) {
            return 4; // owner
        }
        const user = await this.getUserData(senderId);
        return user ? (user.access_level || 0) : 0;
    }
}

module.exports = {
    name: 'users',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db'],

    async init(core) {
        const db = core.get('db');
        const service = new UsersService(db, core);
        core.provide('users', service);
        core.log('users', 'Служба users инициализирована');
    },

    async stop(core) {
        // Не требует очистки
    }
};
