const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
    prefix: '!',
    notifications: true,
    autoStatus: false,
    autoStatusSettings: { mode: 1, interval: 60 },
    autoReadMentions: false,
    autoAddFriends: false,
    autoLeaveChats: false,
    autoUnsubscribe: false,
    dynamicCover: false,
    muteChat: false,
    photoBoost: { active: false, mode: 1, album: null, count: 0 },
    customValues: {
        uptime: null,
        creator: null,
        version: null,
        botName: null,
        status: null
    },
    deepseek: {
        apiKey: '',
        model: 'deepseek-chat',
        enabled: false,
        temperature: 0.7,
        maxTokens: 2000
    }
};

class SettingsService {
    constructor(settingsPath, core) {
        this.settingsPath = settingsPath;
        this.core = core;
        this.data = { ...DEFAULT_SETTINGS };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const raw = fs.readFileSync(this.settingsPath, 'utf8');
                const parsed = JSON.parse(raw);
                this.data = {
                    ...DEFAULT_SETTINGS,
                    ...parsed,
                    customValues: { ...DEFAULT_SETTINGS.customValues, ...(parsed.customValues || {}) },
                    deepseek: { ...DEFAULT_SETTINGS.deepseek, ...(parsed.deepseek || {}) }
                };
            } else {
                // Если файла нет, пытаемся скопировать settings.example.json
                const examplePath = path.resolve(__dirname, '../../../settings.example.json');
                if (fs.existsSync(examplePath)) {
                    const rawExample = fs.readFileSync(examplePath, 'utf8');
                    const parsedExample = JSON.parse(rawExample);
                    this.data = { ...DEFAULT_SETTINGS, ...parsedExample };
                    this.save();
                }
            }
        } catch (e) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('settings', `Ошибка чтения настроек: ${e.message}`);
            }
        }
    }

    save() {
        try {
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.settingsPath, JSON.stringify(this.data, null, 2), 'utf8');
            return true;
        } catch (e) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('settings', `Ошибка сохранения настроек: ${e.message}`);
            }
            return false;
        }
    }

    get prefix() {
        return this.data.prefix || '!';
    }

    setPrefix(p) {
        // Замечание Артёма: строгая валидация от 1 до 10 символов, без пробелов
        if (typeof p !== 'string' || !/^\S{1,10}$/.test(p)) {
            throw new Error('Префикс должен быть непустой строкой от 1 до 10 символов без пробелов');
        }
        this.data.prefix = p;
        this.save();
        if (this.core && typeof this.core.emit === 'function') {
            this.core.emit('prefix:change', p);
        }
        return p;
    }

    get(key, defaultValue = null) {
        return this.data[key] !== undefined ? this.data[key] : defaultValue;
    }

    set(key, value) {
        this.data[key] = value;
        return this.save();
    }

    getAll() {
        return { ...this.data };
    }
}

module.exports = {
    name: 'settings',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['utils'],

    async init(core) {
        const utils = core.get('utils');
        const settingsPath = (utils.paths && utils.paths.SETTINGS_PATH)
            ? utils.paths.SETTINGS_PATH
            : path.resolve(__dirname, '../../../settings.json');

        const service = new SettingsService(settingsPath, core);
        core.provide('settings', service);
        core.log('settings', `Настройки загружены из ${settingsPath}`);
    },

    async stop(core) {
        try {
            const service = core.get('settings');
            if (service && typeof service.save === 'function') {
                service.save();
            }
        } catch {}
    }
};
