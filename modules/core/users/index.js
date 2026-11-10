const LEVEL_1_COMMANDS = new Set([
    'тест', 'пинг', 'test',
    'о_чате', 'инфо', 'чат', 'chat_info',
    'айди', 'id', 'user_id',
    'рег', 'reg_date',
    'проверить', 'check_url',
    'qr', 'чек_qr', 'check_qr',
    'перевод', 'translate',
    'прокси', 'proxy',
    'шаб', 'шаблон', 'шаблоны', 'templates',
    'команды', 'хелп', 'help', 'кмд', 'commands',
    'поиск', 'search',
    'премиум', 'premium',
    'таймеры', 'timers',
    'триггеры', 'triggers'
]);

const LEVEL_2_COMMANDS = new Set([
    'смс', 'удалить', 'delete_messages',
    'закреп', 'пин', 'pin'
]);

class UsersService {
    constructor(db, core) {
        this.db = db;
        this.core = core;
        this.blacklistChats = new Set();
        this.whitelistChats = new Set();
        this.trustedUsers = new Map();
        this.cacheLoaded = false;
    }

    normalizeTgId(tgId) {
        if (!tgId && tgId !== 0) return null;
        const clean = (typeof tgId === 'object' && tgId !== null)
            ? (tgId.userId || tgId.id || tgId.value || tgId)
            : tgId;
        const normalized = typeof clean === 'bigint' ? clean.toString() : String(clean).trim();
        if (normalized === '[object Object]' || normalized === 'NaN' || normalized === 'undefined' || normalized === '') {
            return null;
        }
        return normalized;
    }

    async loadAclCache() {
        this.blacklistChats.clear();
        this.whitelistChats.clear();
        this.trustedUsers.clear();
        try {
            if (this.db && typeof this.db.getAclRules === 'function') {
                const rules = await this.db.getAclRules();
                for (const r of rules || []) {
                    const tid = this.normalizeTgId(r.target_id);
                    if (!tid) continue;
                    if (r.target_type === 'chat') {
                        if (r.rule_type === 'blacklist') this.blacklistChats.add(tid);
                        else if (r.rule_type === 'whitelist') this.whitelistChats.add(tid);
                    } else if (r.target_type === 'user') {
                        if (r.rule_type === 'trusted') this.trustedUsers.set(tid, Number(r.access_level) || 1);
                    }
                }
            }
        } catch (e) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('users', `Ошибка загрузки кэша ACL: ${e.message}`);
            }
        }
        this.cacheLoaded = true;
    }

    isChatBlocked(chatId) {
        const id = this.normalizeTgId(chatId);
        if (!id) return false;
        // 1. Черный список: жесткое заглушение
        if (this.blacklistChats.has(id)) return true;
        // 2. Белый список: если задан хотя бы один чат, все остальные глушатся
        if (this.whitelistChats.size > 0 && !this.whitelistChats.has(id)) return true;
        return false;
    }

    async addBlacklistChat(chatId) {
        const id = this.normalizeTgId(chatId);
        if (!id) throw new Error('Некорректный ID чата');
        if (this.db && typeof this.db.addAclRule === 'function') {
            await this.db.addAclRule('chat', id, 'blacklist', 1);
        }
        this.blacklistChats.add(id);
        return id;
    }

    async removeBlacklistChat(chatId) {
        const id = this.normalizeTgId(chatId);
        if (!id) return false;
        if (this.db && typeof this.db.removeAclRule === 'function') {
            await this.db.removeAclRule('chat', id, 'blacklist');
        }
        this.blacklistChats.delete(id);
        return true;
    }

    getBlacklistChats() {
        return Array.from(this.blacklistChats);
    }

    async clearBlacklistChats() {
        if (this.db && typeof this.db.run === 'function') {
            await this.db.run("DELETE FROM acl WHERE target_type = 'chat' AND rule_type = 'blacklist'");
        }
        this.blacklistChats.clear();
        return true;
    }

    async addWhitelistChat(chatId) {
        const id = this.normalizeTgId(chatId);
        if (!id) throw new Error('Некорректный ID чата');
        if (this.db && typeof this.db.addAclRule === 'function') {
            await this.db.addAclRule('chat', id, 'whitelist', 1);
        }
        this.whitelistChats.add(id);
        return id;
    }

    async removeWhitelistChat(chatId) {
        const id = this.normalizeTgId(chatId);
        if (!id) return false;
        if (this.db && typeof this.db.removeAclRule === 'function') {
            await this.db.removeAclRule('chat', id, 'whitelist');
        }
        this.whitelistChats.delete(id);
        return true;
    }

    getWhitelistChats() {
        return Array.from(this.whitelistChats);
    }

    async clearWhitelistChats() {
        if (this.db && typeof this.db.run === 'function') {
            await this.db.run("DELETE FROM acl WHERE target_type = 'chat' AND rule_type = 'whitelist'");
        }
        this.whitelistChats.clear();
        return true;
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

        const sid = senderId !== undefined && senderId !== null
            ? senderId
            : (message && (message.senderId || message.fromId));

        // Уровень 2: Сверка senderId с ID авторизованного бота/владельца (с безопасным строковым сравнением BigInt)
        if (botInfo && sid) {
            const ownId = this.normalizeTgId(botInfo.id !== undefined ? botInfo.id : botInfo);
            const senderIdNorm = this.normalizeTgId(sid);

            if (ownId && senderIdNorm && ownId === senderIdNorm) {
                return true;
            }
        }

        // Уровень 3: Защитный барьер: любые внешние/входящие сообщения от несовпадающих ID отвергаются
        return false;
    }

    async getUserAccessLevel(senderId, botInfo = null) {
        if (this.isOwnerMessage(null, senderId, botInfo)) {
            return 4; // owner
        }
        const id = this.normalizeTgId(senderId);
        if (!id) return 0;

        // Быстрая проверка из кэша
        if (this.trustedUsers.has(id)) {
            return this.trustedUsers.get(id);
        }

        // Fallback: проверка в таблице acl
        if (this.db && typeof this.db.checkAccess === 'function') {
            try {
                const row = await this.db.checkAccess('user', id, 'trusted');
                if (row && row.access_level) {
                    const lvl = Number(row.access_level);
                    this.trustedUsers.set(id, lvl);
                    return lvl;
                }
            } catch {}
        }

        // Fallback: проверка в таблице users
        const user = await this.getUserData(id);
        if (user && user.access_level > 0) {
            const lvl = Number(user.access_level);
            this.trustedUsers.set(id, lvl);
            return lvl;
        }

        return 0;
    }

    async getAccessLevel(senderId, botInfo = null) {
        return this.getUserAccessLevel(senderId, botInfo);
    }

    async setUserAccessLevel(tgId, level) {
        const id = this.normalizeTgId(tgId);
        if (!id) throw new Error('Некорректный ID пользователя');
        const lvl = Math.max(0, Math.min(3, parseInt(level, 10) || 0));

        if (lvl === 0) {
            if (this.db && typeof this.db.removeAclRule === 'function') {
                await this.db.removeAclRule('user', id, 'trusted');
            }
            this.trustedUsers.delete(id);
            await this.updateAccessLevel(id, 0);
        } else {
            if (this.db && typeof this.db.addAclRule === 'function') {
                await this.db.addAclRule('user', id, 'trusted', lvl);
            }
            this.trustedUsers.set(id, lvl);
            await this.updateAccessLevel(id, lvl);
        }
        return lvl;
    }

    getTrustedUsers() {
        const res = [];
        for (const [id, lvl] of this.trustedUsers.entries()) {
            res.push({ id, level: lvl });
        }
        return res;
    }

    getCommandMinLevel(commandName) {
        const cmd = String(commandName || '').toLowerCase().trim();
        if (LEVEL_1_COMMANDS.has(cmd)) return 1;
        if (LEVEL_2_COMMANDS.has(cmd)) return 2;
        return 4; // Команды владельца (код, префикс, управление доступом, настройки)
    }

    async canUserExecute(commandName, senderId, botInfo = null) {
        const userLevel = await this.getUserAccessLevel(senderId, botInfo);
        const minLevel = this.getCommandMinLevel(commandName);
        return userLevel >= minLevel;
    }
}

module.exports = {
    name: 'users',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db'],
    UsersService,

    async init(core) {
        const db = core.get('db');
        const service = new UsersService(db, core);
        await service.loadAclCache();
        core.provide('users', service);
        core.log('users', 'Служба users инициализирована с поддержкой ACL');
    },

    async stop(core) {
        // Не требует очистки
    }
};
