// renderer.js
const { ipcRenderer } = require('electron');

class BotGUI {
    constructor() {
        this.isBotRunning = false;
        this.logs = [];
        this.commands = [];
        this.prefix = '*';
        this.stats = {
            messages: 0,
            users: 0,
            uptime: 0,
            memory: 0,
            vkEvents: 0
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateStats();
        this.checkBotStatus();
        this.setupPrefixValidation();
        
        // Обновляем статистику каждые 5 секунд
        setInterval(() => this.updateStats(), 5000);
    }

    clearLogs() {
        this.logs = [];
        const logContent = document.getElementById('logContent');
        if (logContent) logContent.replaceChildren();
    }

    exportLogs() {
        const logText = this.logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
        const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `lpbot-logs-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    setupEventListeners() {
        // Навигация
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.switchTab(e.currentTarget.dataset.tab);
            });
        });

        // Кнопки управления ботом
        document.getElementById('startBotBtn').addEventListener('click', () => {
            this.startBot();
        });

        document.getElementById('stopBotBtn').addEventListener('click', () => {
            this.stopBot();
        });

        // Поиск команд
        document.getElementById('commandSearch').addEventListener('input', (e) => {
            this.filterCommands(e.target.value);
        });

        // Обработчики IPC
        ipcRenderer.on('bot-log-update', (event, data) => {
            this.addLog(data);
        });

        ipcRenderer.on('bot-status-update', (event, status) => {
            this.updateBotStatus(status);
        });

        // Кнопки управления окном
        const minimizeBtn = document.getElementById('minimizeBtn');
        const closeBtn = document.getElementById('closeBtn');

        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                ipcRenderer.invoke('minimize-window');
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                ipcRenderer.invoke('close-window');
            });
        }
    }

    // Единый стандарт валидации и нормализации префикса
    normalizePrefixInput(val) {
        if (!val) return '';
        let cleaned = val.replace(/\s+/g, '');
        // Автозамена вариантов кавычек на каноническую '‘' (U+2018)
        cleaned = cleaned.replace(/['’ʼ`]/g, '‘');
        return cleaned.slice(0, 3);
    }

    validatePrefix(prefix) {
        if (!prefix || prefix.length < 1 || prefix.length > 3) {
            return { valid: false, message: 'Префикс: от 1 до 3 символов' };
        }
        if (/\s/.test(prefix)) {
            return { valid: false, message: 'Пробелы запрещены' };
        }
        if (/[\p{L}\p{N}]/u.test(prefix)) {
            return { valid: false, message: 'Буквы и цифры запрещены (только спецсимволы)' };
        }
        return { valid: true, message: 'Префикс корректен' };
    }

    setupPrefixValidation() {
        const input = document.getElementById('commandPrefix');
        const feedback = document.getElementById('prefixValidationFeedback');
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (!input) return;

        const handleInput = () => {
            const normalized = this.normalizePrefixInput(input.value);
            if (input.value !== normalized) {
                input.value = normalized;
            }
            const res = this.validatePrefix(input.value);
            if (feedback) {
                feedback.textContent = res.message;
                feedback.className = `prefix-feedback ${res.valid ? 'valid' : 'invalid'}`;
            }
            input.classList.toggle('is-valid', res.valid);
            input.classList.toggle('is-invalid', !res.valid);
            if (saveBtn) saveBtn.disabled = !res.valid;
        };

        input.addEventListener('input', handleInput);
        input.addEventListener('paste', () => setTimeout(handleInput, 0));
    }

    async switchTab(tabName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');

        document.getElementById('currentTabTitle').textContent = 
            document.querySelector(`[data-tab="${tabName}"] span`).textContent;

        if (tabName === 'commands') {
            this.loadCommands();
        } else if (tabName === 'settings') {
            this.loadSettings();
        }
    }

    async checkBotStatus() {
        try {
            const status = await ipcRenderer.invoke('get-bot-status');
            this.updateBotStatus(status);
        } catch (error) {
            console.error('Ошибка проверки статуса:', error);
        }
    }

    async startBot() {
        try {
            const result = await ipcRenderer.invoke('start-bot');
            this.addLog({
                type: result.success ? 'success' : 'error',
                message: result.message,
                timestamp: new Date().toLocaleTimeString()
            });
        } catch (error) {
            this.addLog({
                type: 'error',
                message: `Ошибка запуска: ${error.message}`,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    }

    async stopBot() {
        try {
            const result = await ipcRenderer.invoke('stop-bot');
            this.addLog({
                type: result.success ? 'warning' : 'error',
                message: result.message,
                timestamp: new Date().toLocaleTimeString()
            });
        } catch (error) {
            this.addLog({
                type: 'error',
                message: `Ошибка остановки: ${error.message}`,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    }

    async getBotStatus() {
        try {
            const status = await ipcRenderer.invoke('get-bot-status');
            this.updateBotStatus(status);
            return status;
        } catch (error) {
            console.error('Ошибка:', error);
            return false;
        }
    }

    updateBotStatus(isRunning) {
        this.isBotRunning = isRunning;
        const tgIndicator = document.getElementById('tgIndicator');
        const startBtn = document.getElementById('startBotBtn');
        const stopBtn = document.getElementById('stopBotBtn');

        if (tgIndicator) {
            if (isRunning) {
                tgIndicator.className = 'indicator state-connected';
            } else {
                tgIndicator.className = 'indicator state-disabled';
            }
        }

        if (startBtn) startBtn.disabled = isRunning;
        if (stopBtn) stopBtn.disabled = !isRunning;
    }

    // Рендеринг лога строго через DOM API и textContent
    addLog(data) {
        this.logs.push(data);
        if (this.logs.length > 1000) {
            this.logs.shift();
        }

        const logContent = document.getElementById('logContent');
        if (!logContent) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${data.type || 'info'}`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = `[${data.timestamp || new Date().toLocaleTimeString()}] `;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'log-message';
        messageSpan.textContent = String(data.message || '');

        logEntry.appendChild(timeSpan);
        logEntry.appendChild(messageSpan);

        logContent.appendChild(logEntry);
        logContent.scrollTop = logContent.scrollHeight;

        this.parseStatsFromLog(data.message);
    }

    parseStatsFromLog(message) {
        if (!message) return;
        if (message.includes('Сообщений в кэше:')) {
            const match = message.match(/Сообщений в кэше: (\d+)/);
            if (match) {
                this.stats.messages = parseInt(match[1]);
                this.updateStatsDisplay();
            }
        }

        if (message.includes('RAM')) {
            const match = message.match(/RAM (\d+)MB/);
            if (match) {
                this.stats.memory = parseInt(match[1]);
                this.updateStatsDisplay();
            }
        }
    }

    async updateStats() {
        if (this.isBotRunning) {
            this.stats.uptime += 5;
            this.updateStatsDisplay();

            // Опрашиваем статистику веб-панели (включая VK)
            try {
                const stats = await this.panel('/api/stats');
                if (stats && stats.uptimeText) {
                    this.updateVkStatusFromPanel(stats);
                    if (stats.memoryMb) this.stats.memory = stats.memoryMb;
                    if (stats.vkEvents !== undefined) this.stats.vkEvents = stats.vkEvents || 0;
                    this.updateStatsDisplay();
                }
            } catch (e) {
                // Бот еще запускается
            }
        } else {
            this.updateVkStatusFromPanel({ vkStatus: { state: 'disabled', text: 'Остановлен', detail: 'Бот не запущен' } });
        }
    }

    updateVkStatusFromPanel(stats) {
        const vkIndicator = document.getElementById('vkIndicator');
        const vkDetail = document.getElementById('vkDetailText');
        const vkCount = document.getElementById('vkEventsCount');

        let state = 'disabled';
        let detail = 'VK не настроен';

        if (stats.vkStatus) {
            state = stats.vkStatus.state || 'disabled';
            detail = stats.vkStatus.detail || stats.vkStatus.text || '';
        } else if (stats.vkConnected === true) {
            state = 'connected';
            detail = 'Long Poll подключен • Туннель :1080 OK';
        } else if (stats.vkConnected === false) {
            state = stats.vkEvents > 0 ? 'warning' : 'disabled';
            detail = stats.vkEvents > 0 ? 'Ожидание Long Poll...' : 'VK клиент отключен';
        }

        if (vkIndicator) {
            vkIndicator.className = `indicator state-${state}`;
        }
        if (vkDetail && detail) {
            vkDetail.textContent = detail;
        }
        if (vkCount && stats.vkEvents !== undefined) {
            vkCount.textContent = String(stats.vkEvents || 0);
        }
    }

    updateStatsDisplay() {
        const msgElem = document.getElementById('messagesCount');
        if (msgElem) msgElem.textContent = this.stats.messages.toLocaleString();
        const usersElem = document.getElementById('usersCount');
        if (usersElem) usersElem.textContent = this.stats.users.toLocaleString();
        const memElem = document.getElementById('memoryUsage');
        if (memElem) memElem.textContent = `${this.stats.memory} MB`;
        const vkElem = document.getElementById('vkEventsCount');
        if (vkElem) vkElem.textContent = String(this.stats.vkEvents || 0);

        const hours = Math.floor(this.stats.uptime / 3600);
        const minutes = Math.floor((this.stats.uptime % 3600) / 60);
        const seconds = this.stats.uptime % 60;
        const uptimeElem = document.getElementById('uptime');
        if (uptimeElem) {
            uptimeElem.textContent = 
                `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    async panel(url, method = 'GET', body) {
        const result = await ipcRenderer.invoke('panel-request', { url, method, body });
        return result.data;
    }

    notify(type, message) {
        this.addLog({ type, message, timestamp: new Date().toLocaleTimeString() });
    }

    async loadCommands() {
        const data = await this.panel('/api/commands');
        this.prefix = data.prefix || '*';
        this.commands = Array.isArray(data.commands) ? data.commands : [];
        if (!data.commands) this.notify('warning', 'Список команд доступен, когда бот запущен');
        this.renderCommands();
    }

    async loadSettings() {
        const data = await this.panel('/api/settings');
        if (data.prefix === undefined) {
            this.notify('warning', 'Настройки доступны, когда бот запущен');
            return;
        }
        const prefixInput = document.getElementById('commandPrefix');
        if (prefixInput) {
            prefixInput.value = data.prefix;
            prefixInput.dispatchEvent(new Event('input'));
        }
        const notif = document.getElementById('notificationsToggle');
        if (notif) notif.checked = Boolean(data.notifications);
        const autoStat = document.getElementById('autoStatusToggle');
        if (autoStat) autoStat.checked = Boolean(data.autoStatus);
    }

    async saveSettings() {
        const prefixInput = document.getElementById('commandPrefix');
        const prefixVal = this.normalizePrefixInput(prefixInput ? prefixInput.value : '');
        const valRes = this.validatePrefix(prefixVal);

        if (!valRes.valid) {
            this.notify('error', valRes.message);
            return;
        }

        const result = await this.panel('/settings', 'POST', {
            prefix: prefixVal,
            notifications: document.getElementById('notificationsToggle').checked,
            autoStatus: document.getElementById('autoStatusToggle').checked
        });

        this.notify(result.success ? 'success' : 'error', result.message);
        if (result.success) {
            this.prefix = prefixVal;
        }
    }

    // Рендеринг команд строго через DOM API и textContent
    renderCommands() {
        const container = document.getElementById('commandsList');
        if (!container) return;
        container.replaceChildren();

        if (this.commands.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'command-item';
            empty.textContent = 'Команды не загружены';
            container.appendChild(empty);
            return;
        }

        this.commands.forEach(command => {
            const item = document.createElement('div');
            item.className = 'command-item';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'command-name';
            nameDiv.textContent = `${this.prefix || ''}${command.name}`;

            const descDiv = document.createElement('div');
            descDiv.className = 'command-desc';
            descDiv.textContent = command.description || '';

            item.appendChild(nameDiv);
            item.appendChild(descDiv);
            container.appendChild(item);
        });
    }

    filterCommands(query) {
        const lowerQuery = (query || '').toLowerCase();
        const filtered = this.commands.filter(cmd => 
            String(cmd.name || '').toLowerCase().includes(lowerQuery) ||
            String(cmd.description || '').toLowerCase().includes(lowerQuery)
        );

        const container = document.getElementById('commandsList');
        if (!container) return;
        container.replaceChildren();

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'command-item';
            empty.textContent = `Команды не найдены для "${query}"`;
            container.appendChild(empty);
            return;
        }

        filtered.forEach(command => {
            const item = document.createElement('div');
            item.className = 'command-item';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'command-name';
            nameDiv.textContent = `${this.prefix || ''}${command.name}`;

            const descDiv = document.createElement('div');
            descDiv.className = 'command-desc';
            descDiv.textContent = command.description || '';

            item.appendChild(nameDiv);
            item.appendChild(descDiv);
            container.appendChild(item);
        });
    }
}

// Глобальные функции для кнопок
function showCommands() {
    if (window.botGUI) window.botGUI.switchTab('commands');
}

function openSettings() {
    if (window.botGUI) window.botGUI.switchTab('settings');
}

function saveSettings() {
    if (window.botGUI) window.botGUI.saveSettings();
}

function resetSettings() {
    if (window.botGUI) window.botGUI.loadSettings();
}

function clearLogs() {
    if (window.botGUI) window.botGUI.clearLogs();
}

function exportLogs() {
    if (window.botGUI) window.botGUI.exportLogs();
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    window.botGUI = new BotGUI();
    window.startBot = () => window.botGUI.startBot();
    window.stopBot = () => window.botGUI.stopBot();
    window.getBotStatus = () => window.botGUI.getBotStatus();
});
