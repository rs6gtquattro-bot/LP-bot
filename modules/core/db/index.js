const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../../../paths.js');

/**
 * Модуль службы базы данных LP-bot (Этап 2 модульности)
 * Соответствует спецификации docs/modules.md
 */

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tg_id BIGINT UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        access_level INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_stats (
        user_id INTEGER PRIMARY KEY,
        messages_sent INTEGER DEFAULT 0,
        commands_executed INTEGER DEFAULT 0,
        last_activity DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        command TEXT,
        arguments TEXT,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS access_levels (
        level INTEGER PRIMARY KEY,
        name TEXT,
        description TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS photo_boost_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_url TEXT,
        photos_added INTEGER DEFAULT 0,
        last_boost DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT UNIQUE,
        responses TEXT,
        settings TEXT,
        used_count INTEGER DEFAULT 0,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        content_type TEXT,
        text_content TEXT,
        media_data BLOB,
        file_name TEXT,
        mime_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used_count INTEGER DEFAULT 0,
        last_used DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS timers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        chat_id BIGINT,
        message_text TEXT,
        trigger_time DATETIME,
        interval_seconds INTEGER,
        repeat_count INTEGER DEFAULT 0,
        current_count INTEGER DEFAULT 0,
        enabled BOOLEAN DEFAULT true,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_triggered DATETIME,
        settings TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS vk_state (
        key TEXT PRIMARY KEY,
        value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS _corrupted_users_backup (
        id INTEGER,
        tg_id TEXT,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        access_level INTEGER,
        created_at DATETIME,
        updated_at DATETIME,
        backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
];

const INDEX_STATEMENTS = [
    `CREATE INDEX IF NOT EXISTS idx_command_history_user_id ON command_history(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_command_history_executed_at ON command_history(executed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_timers_trigger_time ON timers(trigger_time) WHERE enabled = 1`,
    `CREATE INDEX IF NOT EXISTS idx_triggers_used_count ON triggers(used_count DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id)`
];

const DEFAULT_ACCESS_LEVELS = [
    [0, 'user', 'Обычный пользователь'],
    [1, 'trusted', 'Проверенный пользователь'],
    [2, 'moderator', 'Модератор'],
    [3, 'admin', 'Администратор'],
    [4, 'owner', 'Владелец']
];

class DatabaseService {
    constructor(db = null, dbPath = DB_PATH) {
        this.db = db;
        this.dbPath = dbPath;
    }

    /**
     * Открытие БД с обязательной установкой всех продакшн-PRAGMA и накатыванием схемы
     */
    open(targetPath = this.dbPath || DB_PATH) {
        this.dbPath = targetPath;
        return new Promise((resolve, reject) => {
            const rawDb = new sqlite3.Database(this.dbPath, (err) => {
                if (err) return reject(err);
                this.db = rawDb;

                // Обязательная настройка продакшн-PRAGMA
                this.db.serialize(() => {
                    this.db.run('PRAGMA foreign_keys = ON;');
                    this.db.run('PRAGMA busy_timeout = 5000;');
                    this.db.run('PRAGMA journal_mode = WAL;');
                    this.db.run('PRAGMA synchronous = NORMAL;', (pragmaErr) => {
                        if (pragmaErr) {
                            console.error('⚠️ Ошибка применения PRAGMA:', pragmaErr.message);
                        }
                        this.initSchema().then(() => resolve(this)).catch(reject);
                    });
                });
            });
        });
    }

    async initSchema() {
        for (const ddl of DDL_STATEMENTS) {
            await this.run(ddl);
        }
        for (const idx of INDEX_STATEMENTS) {
            await this.run(idx);
        }
        for (const [level, name, description] of DEFAULT_ACCESS_LEVELS) {
            await this.run(
                'INSERT OR IGNORE INTO access_levels (level, name, description) VALUES (?, ?, ?)',
                [level, name, description]
            );
        }
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('Database connection is not open'));
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('Database connection is not open'));
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('Database connection is not open'));
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    exec(sql) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('Database connection is not open'));
            this.db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    serialize(fn) {
        if (!this.db) throw new Error('Database connection is not open');
        return this.db.serialize(fn);
    }

    async transaction(fn) {
        await this.run('BEGIN IMMEDIATE');
        try {
            const result = await fn(this);
            await this.run('COMMIT');
            return result;
        } catch (error) {
            try { await this.run('ROLLBACK'); } catch (_) {}
            throw error;
        }
    }

    async close() {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                this.db = null;
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // ---------- Специализированные методы пользователей ----------
    normalizeTgId(tgId) {
        if (!tgId) return null;
        const clean = typeof tgId === 'object' && tgId !== null ? (tgId.userId || tgId.id || tgId.value || tgId) : tgId;
        const normalized = typeof clean === 'bigint' ? clean.toString() : String(clean);
        return normalized === '[object Object]' ? null : normalized;
    }

    async getUser(tgId) {
        const id = this.normalizeTgId(tgId);
        if (!id) return null;
        return this.get('SELECT * FROM users WHERE tg_id = ?', [id]);
    }

    async ensureUser(tgId, username = null, firstName = null, lastName = null, accessLevel = 0) {
        const id = this.normalizeTgId(tgId);
        if (!id) {
            console.error('⚠️ Предотвращена вставка невалидного tg_id в users');
            return null;
        }
        await this.run(
            `INSERT OR IGNORE INTO users (tg_id, username, first_name, last_name, access_level) VALUES (?, ?, ?, ?, ?)`,
            [id, username, firstName, lastName, accessLevel]
        );
        return this.getUser(id);
    }

    // ---------- Специализированные методы триггеров ----------
    async loadTriggers() {
        const rows = await this.all('SELECT word, responses, settings, used_count, last_used, created_at FROM triggers');
        const map = new Map();
        for (const row of rows) {
            try {
                map.set(row.word, {
                    word: row.word,
                    responses: typeof row.responses === 'string' ? JSON.parse(row.responses) : row.responses,
                    settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings,
                    used_count: row.used_count || 0,
                    last_used: row.last_used || null,
                    created_at: row.created_at
                });
            } catch (e) {
                console.error(`⚠️ Ошибка разбора триггера "${row.word}":`, e.message);
            }
        }
        return map;
    }

    async saveTriggers(triggers) {
        const list = triggers instanceof Map ? [...triggers.values()] : (Array.isArray(triggers) ? triggers : []);
        const active = list.filter(t => t && t.word && t.responses && t.settings);
        const words = active.map(t => t.word);

        return this.transaction(async () => {
            if (words.length > 0) {
                const placeholders = words.map(() => '?').join(',');
                await this.run(`DELETE FROM triggers WHERE word NOT IN (${placeholders})`, words);
            } else {
                await this.run('DELETE FROM triggers');
            }

            const upsertSql = `
                INSERT INTO triggers (word, responses, settings, used_count, last_used, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(word) DO UPDATE SET
                    responses = excluded.responses,
                    settings = excluded.settings,
                    used_count = CASE WHEN excluded.used_count > triggers.used_count THEN excluded.used_count ELSE triggers.used_count END,
                    last_used = COALESCE(excluded.last_used, triggers.last_used)
            `;

            for (const t of active) {
                await this.run(upsertSql, [
                    t.word,
                    JSON.stringify(t.responses),
                    JSON.stringify(t.settings),
                    t.settings.used || t.used_count || 0,
                    t.settings.lastUsed || t.last_used || null,
                    t.settings.created || t.created_at || new Date().toISOString()
                ]);
            }
            return active.length;
        });
    }

    // ---------- Специализированные методы шаблонов ----------
    async getAllTemplates() {
        return this.all('SELECT name, content_type, used_count, last_used FROM templates ORDER BY name');
    }

    async getTemplate(name) {
        return this.get(
            'SELECT name, content_type, text_content, media_data, file_name, mime_type, used_count, last_used FROM templates WHERE name = ?',
            [name]
        );
    }

    async saveTemplate(tpl) {
        return this.run(
            `INSERT INTO templates (name, content_type, text_content, media_data, file_name, mime_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(name) DO UPDATE SET
                 content_type = excluded.content_type,
                 text_content = excluded.text_content,
                 media_data = excluded.media_data,
                 file_name = excluded.file_name,
                 mime_type = excluded.mime_type`,
            [tpl.name, tpl.contentType, tpl.textContent, tpl.mediaData, tpl.fileName, tpl.mimeType]
        );
    }

    async updateTemplateUsage(name) {
        return this.run(
            'UPDATE templates SET used_count = used_count + 1, last_used = ? WHERE name = ?',
            [new Date().toISOString(), name]
        );
    }

    async deleteTemplate(name) {
        return this.run('DELETE FROM templates WHERE name = ?', [name]);
    }

    // ---------- Специализированные методы таймеров ----------
    async loadTimers() {
        const rows = await this.all('SELECT * FROM timers');
        const map = new Map();
        for (const row of rows) {
            try {
                map.set(row.name, {
                    id: row.id,
                    name: row.name,
                    chatId: row.chat_id,
                    messageText: row.message_text,
                    triggerTime: row.trigger_time ? new Date(row.trigger_time) : new Date(),
                    intervalSeconds: row.interval_seconds,
                    repeatCount: row.repeat_count,
                    currentCount: row.current_count,
                    enabled: Boolean(row.enabled),
                    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
                    lastTriggered: row.last_triggered ? new Date(row.last_triggered) : null,
                    settings: row.settings ? JSON.parse(row.settings) : {}
                });
            } catch (e) {
                console.error(`⚠️ Ошибка разбора таймера "${row.name}":`, e.message);
            }
        }
        return map;
    }

    async saveTimers(timers) {
        const list = timers instanceof Map ? [...timers.values()] : (Array.isArray(timers) ? timers : []);
        const active = list.filter(t => t && t.name);
        const names = active.map(t => t.name);

        return this.transaction(async () => {
            if (names.length > 0) {
                const placeholders = names.map(() => '?').join(',');
                await this.run(`DELETE FROM timers WHERE name NOT IN (${placeholders})`, names);
            } else {
                await this.run('DELETE FROM timers');
            }

            const upsertSql = `
                INSERT INTO timers (name, chat_id, message_text, trigger_time, interval_seconds, repeat_count, current_count, enabled, created_at, last_triggered, settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    chat_id = excluded.chat_id,
                    message_text = excluded.message_text,
                    trigger_time = excluded.trigger_time,
                    interval_seconds = excluded.interval_seconds,
                    repeat_count = excluded.repeat_count,
                    current_count = excluded.current_count,
                    enabled = excluded.enabled,
                    last_triggered = excluded.last_triggered,
                    settings = excluded.settings
            `;

            for (const t of active) {
                await this.run(upsertSql, [
                    t.name,
                    t.chatId,
                    t.messageText,
                    t.triggerTime instanceof Date ? t.triggerTime.toISOString() : (t.triggerTime || new Date().toISOString()),
                    t.intervalSeconds,
                    t.repeatCount || 0,
                    t.currentCount || 0,
                    t.enabled !== false,
                    t.createdAt instanceof Date ? t.createdAt.toISOString() : (t.createdAt || new Date().toISOString()),
                    t.lastTriggered instanceof Date ? t.lastTriggered.toISOString() : (t.lastTriggered || null),
                    JSON.stringify(t.settings || {})
                ]);
            }
            return active.length;
        });
    }

    // ---------- Состояние VK ----------
    async getVkState(key = 'state') {
        const row = await this.get('SELECT value FROM vk_state WHERE key = ?', [key]);
        if (!row || !row.value) return null;
        try { return JSON.parse(row.value); } catch { return null; }
    }

    async setVkState(key = 'state', value = {}) {
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        return this.run('INSERT OR REPLACE INTO vk_state (key, value) VALUES (?, ?)', [key, valStr]);
    }
}

/**
 * Создание и открытие экземпляра службы БД
 */
async function open(dbPath = DB_PATH) {
    const service = new DatabaseService(null, dbPath);
    await service.open(dbPath);
    return service;
}

module.exports = {
    name: 'db',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: [],
    open,

    async init(core) {
        // Путь берется строго из paths.js (DB_PATH), с поддержкой core.options.dbPath для тестов
        const dbPath = (core && core.options && core.options.dbPath) || process.env.LP_DB_PATH || DB_PATH;

        const dbService = await open(dbPath);

        if (core && typeof core.log === 'function') {
            core.log('db', `Database ready at ${dbPath} (WAL, busy_timeout=5000, foreign_keys=ON)`);
        }

        // Регистрация службы в ядре
        core.provide('db', dbService);
        this._service = dbService;
    },

    async stop(core) {
        if (this._service) {
            await this._service.close();
            this._service = null;
            if (core && typeof core.log === 'function') {
                core.log('db', 'Database connection closed');
            }
        }
    }
};
