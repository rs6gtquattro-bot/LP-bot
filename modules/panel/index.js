const fs = require('fs');
const path = require('path');
const WebInterface = require('../../web_interface.js');

let panelInstance = null;

module.exports = {
    name: 'panel',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['settings', 'telegram', 'db', 'process', 'utils'],

    async init(core) {
        const settings = core.get('settings');
        const telegram = core.get('telegram');
        const db = core.get('db');
        const proc = core.get('process');
        const utils = core.get('utils');

        let configPanelPort = null;
        let configPanelHost = null;
        let configPanelToken = null;
        try {
            const configPath = (utils && utils.paths && utils.paths.CONFIG_PATH) || path.join(__dirname, '..', '..', 'config.json');
            if (fs.existsSync(configPath)) {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (cfg) {
                    if (cfg.panelPort !== undefined && cfg.panelPort !== null) configPanelPort = Number(cfg.panelPort);
                    if (cfg.panelHost) configPanelHost = cfg.panelHost;
                    if (cfg.panelToken) configPanelToken = cfg.panelToken;
                }
            }
        } catch {
            // ignore config read errors
        }

        const host = (core.options && core.options.panelHost) || process.env.PANEL_HOST || configPanelHost || '127.0.0.1';
        const port = (core.options && core.options.panelPort !== undefined)
            ? Number(core.options.panelPort)
            : (Number(process.env.PANEL_PORT) || configPanelPort || 3005);
        const token = (core.options && core.options.panelToken) || process.env.PANEL_TOKEN || configPanelToken || null;

        const botAdapter = {
            settings: {
                get prefix() { return settings.prefix; },
                set prefix(p) {
                    if (typeof settings.setPrefix === 'function') settings.setPrefix(p);
                    else settings.set('prefix', p);
                },
                triggers: new Map(),
                timers: new Map(),
                templates: new Map(),
                get customValues() { return (settings.get && settings.get('customValues')) || {}; },
                get deepseek() { return (settings.get && settings.get('deepseek')) || {}; }
            },
            get commands() {
                return Object.fromEntries(core.commands || []);
            },
            isRunning: true,
            startTime: (proc && proc.startTime) || new Date(),
            get telegramClient() { return telegram.client; },
            get vkClient() {
                try { return core.get('vk'); } catch { return null; }
            },
            db,
            async getAllTemplates() {
                if (db && typeof db.getAllTemplates === 'function') {
                    return await db.getAllTemplates();
                }
                return [];
            },
            saveSettings() {
                if (typeof settings.save === 'function') settings.save();
            }
        };

        panelInstance = new WebInterface(botAdapter, db, port, host, token);

        // Запуск HTTP и WebSocket сервера (с поддержкой прогона в headless-тестах)
        if (!process.env.HEADLESS_TEST && (!core.options || !core.options.headless)) {
            await panelInstance.start();
        }

        core.provide('panel', panelInstance);
        core.log('panel', `Web panel ready on ${host}:${port}`);
    },

    async stop(core) {
        if (panelInstance) {
            try {
                panelInstance.stop();
            } catch {}
            panelInstance = null;
            core.log('panel', 'Web panel stopped');
        }
    }
};
