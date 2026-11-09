// WebSocket соединение для реального времени
class BotDashboard {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.connect();
        this.startStatusUpdates();
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('🔗 WebSocket подключен');
            this.reconnectAttempts = 0;
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.ws.onclose = () => {
            console.log('🔗 WebSocket отключен');
            this.attemptReconnect();
        };
        
        this.ws.onerror = (error) => {
            console.error('❌ WebSocket ошибка:', error);
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 10000);
            console.log(`🔄 Попытка переподключения ${this.reconnectAttempts} через ${delay}ms`);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'status':
                this.updateStatus(data.data);
                break;
            case 'update':
                this.handleUpdate(data.data);
                break;
        }
    }

    updateStatus(status) {
        // Обновляем индикатор статуса
        const indicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        
        if (status.status === 'running') {
            indicator.className = 'status-indicator connected';
            statusText.textContent = 'Бот активен';
            statusText.style.color = '#38a169';
        } else {
            indicator.className = 'status-indicator';
            statusText.textContent = 'Бот остановлен';
            statusText.style.color = '#e53e3e';
        }

        // Обновляем данные на главной странице
        document.getElementById('botStatus').textContent = status.status === 'running' ? 'Активен' : 'Остановлен';
        document.getElementById('uptime').textContent = status.uptime;
        document.getElementById('memory').textContent = `${status.memory} MB`;
        document.getElementById('triggersCount').textContent = status.triggers;
        document.getElementById('telegramStatus').textContent = status.connection ? 'Подключено' : 'Отключено';
    }

    handleUpdate(update) {
        // Обновляем страницу при изменениях
        if (update.entity === 'triggers' && window.location.pathname === '/triggers') {
            this.loadTriggers();
        } else if (update.entity === 'settings' && window.location.pathname === '/settings') {
            this.showNotification('Настройки обновлены', 'success');
        }
    }

    async loadTriggers() {
        try {
            const response = await fetch('/api/triggers');
            const data = await response.json();
            this.renderTriggers(data.triggers);
        } catch (error) {
            console.error('Ошибка загрузки триггеров:', error);
        }
    }

    renderTriggers(triggers) {
        const container = document.getElementById('triggersContainer');
        if (!container) return;

        container.innerHTML = triggers.map(trigger => `
            <div class="table-row">
                <div class="trigger-word">${trigger.word}</div>
                <div class="trigger-responses">${trigger.responses.slice(0, 2).join(', ')}</div>
                <div class="trigger-actions">
                    <button onclick="deleteTrigger('${trigger.word}')" class="btn danger">Удалить</button>
                </div>
            </div>
        `).join('');
    }

    startStatusUpdates() {
        // Периодически обновляем статус
        setInterval(() => {
            this.fetchStatus();
        }, 5000);
    }

    async fetchStatus() {
        try {
            const response = await fetch('/status');
            const status = await response.json();
            this.updateStatus(status);
        } catch (error) {
            console.error('Ошибка получения статуса:', error);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `alert ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Глобальные функции
async function deleteTrigger(word) {
    if (!confirm(`Удалить триггер "${word}"?`)) return;
    
    try {
        const response = await fetch(`/triggers/${encodeURIComponent(word)}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.success) {
            dashboard.showNotification('Триггер удален', 'success');
            dashboard.loadTriggers();
        } else {
            dashboard.showNotification(result.message, 'error');
        }
    } catch (error) {
        dashboard.showNotification('Ошибка удаления триггера', 'error');
    }
}

async function saveSettings(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);
    
    try {
        const response = await fetch('/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        
        dashboard.showNotification(result.message, result.success ? 'success' : 'error');
    } catch (error) {
        dashboard.showNotification('Ошибка сохранения настроек', 'error');
    }
}

// Инициализация при загрузке страницы
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new BotDashboard();
    
    // Загружаем начальные данные
    dashboard.fetchStatus();
    
    // Если на странице триггеров - загружаем их
    if (window.location.pathname === '/triggers') {
        dashboard.loadTriggers();
    }
});