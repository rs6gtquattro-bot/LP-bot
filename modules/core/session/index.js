const fs = require('fs');
const path = require('path');

class SessionService {
    constructor(sessionPath, core) {
        this.sessionPath = sessionPath;
        this.core = core;
    }

    loadSession() {
        try {
            if (fs.existsSync(this.sessionPath)) {
                const sessionData = fs.readFileSync(this.sessionPath, 'utf8').trim();
                if (sessionData && sessionData.length > 10) {
                    return sessionData;
                }
            }
        } catch (e) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('session', `Ошибка загрузки сессии: ${e.message}`);
            }
        }
        return null;
    }

    saveSession(sessionString) {
        try {
            const dir = path.dirname(this.sessionPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.sessionPath, String(sessionString || ''), { encoding: 'utf8', mode: 0o600 });
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('session', `Сессия сохранена в ${this.sessionPath}`);
            }
            return true;
        } catch (e) {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('session', `Ошибка сохранения сессии: ${e.message}`);
            }
            return false;
        }
    }

    clearSession() {
        return this.saveSession('');
    }

    hasSession() {
        const s = this.loadSession();
        return Boolean(s && s.length > 10);
    }
}

module.exports = {
    name: 'session',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['utils'],

    async init(core) {
        const utils = core.get('utils');
        const sessionPath = (utils.paths && utils.paths.SESSION_PATH)
            ? utils.paths.SESSION_PATH
            : path.resolve(__dirname, '../../../session.txt');

        const service = new SessionService(sessionPath, core);
        core.provide('session', service);
        core.log('session', `Служба session инициализирована (${sessionPath})`);
    },

    async stop(core) {
        // Сервис сессии не держит открытых дескрипторов
    }
};
