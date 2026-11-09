// renderer.js
const { ipcRenderer } = require('electron');

class BotGUI {
    constructor() {
        this.isBotRunning = false;
        this.logs = [];
        this.commands = [];
        this.stats = {
            messages: 0,
            users: 0,
            uptime: 0,
            memory: 0
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadCommands();
        this.updateStats();
        this.checkBotStatus();
        
        // Обновляем статистику каждые 5 секунд
        setInterval(() => this.updateStats(), 5000);
    }

    // Добавить метод в класс BotGUI:
    clearLogs() {
    this.logs = [];
    document.getElementById('logContent').innerHTML = '';
    }

    exportLogs() {
    const logText = this.logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `bot-logs-${new Date().toISOString().split('T')[0]}.txt`;
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

    async switchTab(tabName) {
        // Обновляем активную вкладку в навигации
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Показываем соответствующую панель
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');

        // Обновляем заголовок
        document.getElementById('currentTabTitle').textContent = 
            document.querySelector(`[data-tab="${tabName}"] span`).textContent;

        // Загружаем данные для вкладки при необходимости
        if (tabName === 'stats') {
            this.loadCharts();
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

    // Проверка статуса
    async getBotStatus() {
        try {
            const status = await ipcRenderer.invoke('get-bot-status');
            console.log('Статус бота:', status);
            this.updateBotStatus(status);
            return status;
        } catch (error) {
            console.error('Ошибка:', error);
            return false;
        }
    }

    updateBotStatus(isRunning) {
        this.isBotRunning = isRunning;
        const indicator = document.querySelector('.indicator');
        const statusText = document.querySelector('.status-indicator span');
        const startBtn = document.getElementById('startBotBtn');
        const stopBtn = document.getElementById('stopBotBtn');

        if (isRunning) {
            indicator.classList.add('active');
            statusText.textContent = 'Активно';
            startBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            indicator.classList.remove('active');
            statusText.textContent = 'Неактивно';
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    addLog(data) {
        this.logs.push(data);
        if (this.logs.length > 1000) {
            this.logs.shift();
        }

        const logContent = document.getElementById('logContent');
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${data.type}`;
        logEntry.innerHTML = `
            <span class="log-time">[${data.timestamp}]</span>
            <span class="log-message">${data.message}</span>
        `;

        logContent.appendChild(logEntry);
        logContent.scrollTop = logContent.scrollHeight;

        // Автоматически парсим статистику из логов
        this.parseStatsFromLog(data.message);
    }

    parseStatsFromLog(message) {
        // Парсим статистику из логов бота
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

    updateStats() {
        // Обновляем время работы
        if (this.isBotRunning) {
            this.stats.uptime += 5;
            this.updateStatsDisplay();
        }
    }

    updateStatsDisplay() {
        document.getElementById('messagesCount').textContent = this.stats.messages.toLocaleString();
        document.getElementById('usersCount').textContent = this.stats.users.toLocaleString();
        document.getElementById('memoryUsage').textContent = `${this.stats.memory} MB`;
        
        // Форматируем время работы
        const hours = Math.floor(this.stats.uptime / 3600);
        const minutes = Math.floor((this.stats.uptime % 3600) / 60);
        const seconds = this.stats.uptime % 60;
        document.getElementById('uptime').textContent = 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    loadCommands() {
        // Загружаем список команд из вашего бота
        this.commands = [
            { name: 'уведы', description: 'Включить/выключить уведомления' },
            { name: 'автостатус', description: 'Управление автостатусом' },
            { name: 'qr', description: 'Генерация QR-кода' },
            { name: 'перевод', description: 'Перевод текста на русский' },
            { name: 'айди', description: 'Показать ID пользователя' },
            { name: 'мегапуш', description: 'Массовая рассылка' },
            { name: 'команды', description: 'Показать список команд' },
            // Добавьте остальные команды из вашего бота
        ];

        this.renderCommands();
    }

    renderCommands() {
        const container = document.getElementById('commandsList');
        container.innerHTML = '';

        this.commands.forEach(command => {
            const item = document.createElement('div');
            item.className = 'command-item';
            item.innerHTML = `
                <div class="command-name">!${command.name}</div>
                <div class="command-desc">${command.description}</div>
            `;
            container.appendChild(item);
        });
    }

    filterCommands(query) {
        const filtered = this.commands.filter(cmd => 
            cmd.name.toLowerCase().includes(query.toLowerCase()) ||
            cmd.description.toLowerCase().includes(query.toLowerCase())
        );

        const container = document.getElementById('commandsList');
        container.innerHTML = '';

        filtered.forEach(command => {
            const item = document.createElement('div');
            item.className = 'command-item';
            item.innerHTML = `
                <div class="command-name">!${command.name}</div>
                <div class="command-desc">${command.description}</div>
            `;
            container.appendChild(item);
        });
    }

    loadCharts() {
        // Заглушка для графиков - можно реализовать с помощью Chart.js
        console.log('Loading charts...');
    }

    clearLogs() {
        document.getElementById('logContent').innerHTML = '';
        this.logs = [];
    }

    exportLogs() {
        const logText = this.logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `lpbot-logs-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        
        URL.revokeObjectURL(url);
    }
}

// Глобальные функции для кнопок
function sendTestCommand() {
    // Реализация отправки тестовой команды
    console.log('Sending test command...');
}

function clearCache() {
    // Реализация очистки кэша
    console.log('Clearing cache...');
}

function showCommands() {
    const gui = new BotGUI();
    gui.switchTab('commands');
}

function openSettings() {
    const gui = new BotGUI();
    gui.switchTab('settings');
}

function saveSettings() {
    // Реализация сохранения настроек
    console.log('Saving settings...');
}

function resetSettings() {
    // Реализация сброса настроек
    console.log('Resetting settings...');
}

function clearLogs() {
    if (window.botGUI) {
        window.botGUI.clearLogs();
    }
}

function exportLogs() {
    if (window.botGUI) {
        window.botGUI.exportLogs();
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    window.botGUI = new BotGUI();
    
    // Дополнительные глобальные функции
    window.startBot = () => window.botGUI.startBot();
    window.stopBot = () => window.botGUI.stopBot();
    window.getBotStatus = () => window.botGUI.getBotStatus();
});