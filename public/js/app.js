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
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                console.error('Ошибка парсинга WebSocket сообщения:', e);
            }
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
        if (!status) return;

        // 1. Статус Telegram
        const tgIndicator = document.getElementById('statusIndicator') || document.getElementById('tgStatusIndicator');
        const tgStatusText = document.getElementById('statusText') || document.getElementById('tgStatusText');
        const isRunning = status.status === 'running' || Boolean(status.connection);
        
        if (tgIndicator) {
            tgIndicator.className = isRunning ? 'status-indicator connected' : 'status-indicator';
        }
        if (tgStatusText) {
            tgStatusText.textContent = isRunning ? 'TG: Активен' : 'TG: Отключен';
            tgStatusText.style.color = isRunning ? '#38a169' : '#e53e3e';
        }

        // 2. Статус VK (4 цветовых состояния: connected, warning, error, disabled)
        this.updateVkStatusDisplay(status);

        // 3. Данные на главной странице
        const botStatus = document.getElementById('botStatus');
        if (botStatus) botStatus.textContent = isRunning ? 'Активен' : 'Остановлен';
        const uptime = document.getElementById('uptime');
        if (uptime && status.uptime) uptime.textContent = status.uptime;
        const memory = document.getElementById('memory');
        if (memory && status.memory !== undefined) memory.textContent = `${status.memory} MB`;
        const triggersCount = document.getElementById('triggersCount');
        if (triggersCount && status.triggers !== undefined) triggersCount.textContent = status.triggers;
        const telegramStatus = document.getElementById('telegramStatus');
        if (telegramStatus) telegramStatus.textContent = status.connection ? 'Подключено' : 'Отключено';
    }

    updateVkStatusDisplay(status) {
        const vkIndicator = document.getElementById('vkStatusIndicator');
        const vkStatusText = document.getElementById('vkStatusText');
        const vkEventsElem = document.getElementById('vkEventsCount');
        const vkStatusDetail = document.getElementById('vkStatusDetail');

        // Определяем состояние VK: connected (green), warning (yellow), error (red), disabled (gray)
        let state = 'disabled';
        let label = 'VK: Отключен';
        let detail = 'Токен не задан';

        if (status.vkStatus) {
            state = status.vkStatus.state || 'disabled';
            label = `VK: ${status.vkStatus.text || 'Отключен'}`;
            detail = status.vkStatus.detail || '';
        } else if (status.vkConnected === true) {
            state = 'connected';
            label = 'VK: Активен';
            detail = 'Long Poll подключен';
        } else if (status.vkConnected === false) {
            state = status.vkEvents > 0 ? 'warning' : 'disabled';
            label = status.vkEvents > 0 ? 'VK: Переподключение' : 'VK: Отключен';
            detail = status.vkEvents > 0 ? 'Ожидание Long Poll' : 'Клиент не запущен';
        }

        if (vkIndicator) {
            vkIndicator.className = `status-indicator state-${state}`;
        }
        if (vkStatusText) {
            vkStatusText.textContent = label;
            const colors = { connected: '#38a169', warning: '#d69e2e', error: '#e53e3e', disabled: '#a0aec0' };
            vkStatusText.style.color = colors[state] || '#a0aec0';
        }
        if (vkEventsElem && status.vkEvents !== undefined && status.vkEvents !== null) {
            vkEventsElem.textContent = String(status.vkEvents);
        }
        if (vkStatusDetail && detail) {
            vkStatusDetail.textContent = detail;
        }
    }

    handleUpdate(update) {
        if (!update) return;
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
            this.renderTriggers(data.triggers || []);
        } catch (error) {
            console.error('Ошибка загрузки триггеров:', error);
        }
    }

    // Рендеринг строго через DOM API и textContent — никакого innerHTML
    renderTriggers(triggers) {
        const container = document.getElementById('triggersContainer');
        if (!container) return;

        container.replaceChildren();

        if (!triggers || triggers.length === 0) {
            const emptyRow = document.createElement('div');
            emptyRow.className = 'table-row';
            const emptyDiv = document.createElement('div');
            emptyDiv.style.textAlign = 'center';
            emptyDiv.style.padding = '2rem';
            emptyDiv.style.color = '#6b7280';
            emptyDiv.textContent = '📭 Триггеры не найдены';
            emptyRow.appendChild(emptyDiv);
            container.appendChild(emptyRow);
            return;
        }

        triggers.forEach(trigger => {
            const row = document.createElement('div');
            row.className = 'table-row';

            const wordDiv = document.createElement('div');
            wordDiv.className = 'trigger-word';
            wordDiv.textContent = trigger.word;

            const responsesDiv = document.createElement('div');
            responsesDiv.className = 'trigger-responses';
            const responsesText = Array.isArray(trigger.responses)
                ? trigger.responses.slice(0, 2).join(', ')
                : String(trigger.responses || '');
            responsesDiv.textContent = responsesText;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'trigger-actions';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn danger small';
            deleteBtn.textContent = 'Удалить';
            deleteBtn.dataset.word = trigger.word;
            deleteBtn.addEventListener('click', () => deleteTrigger(trigger.word));

            actionsDiv.appendChild(deleteBtn);
            row.appendChild(wordDiv);
            row.appendChild(responsesDiv);
            row.appendChild(actionsDiv);

            container.appendChild(row);
        });
    }

    startStatusUpdates() {
        setInterval(() => {
            this.fetchStatus();
        }, 5000);
    }

    async fetchStatus() {
        try {
            const response = await fetch('/api/stats');
            if (response.ok) {
                const stats = await response.json();
                this.updateStatus(stats);
            }
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
    if (!word) return;
    if (!confirm(`Удалить триггер "${word}"?`)) return;
    
    try {
        const response = await fetch(`/triggers/${encodeURIComponent(word)}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.success) {
            if (dashboard) {
                dashboard.showNotification('Триггер удален', 'success');
                dashboard.loadTriggers();
            }
        } else {
            if (dashboard) dashboard.showNotification(result.message || 'Ошибка удаления', 'error');
        }
    } catch (error) {
        if (dashboard) dashboard.showNotification('Ошибка удаления триггера', 'error');
    }
}

// Единый стандарт валидации и нормализации префикса
function normalizePrefixInput(val) {
    if (!val) return '';
    let cleaned = val.replace(/\s+/g, '');
    // Автозамена вариантов кавычек на каноническую '‘' (U+2018)
    cleaned = cleaned.replace(/['’ʼ`]/g, '‘');
    return cleaned.slice(0, 3);
}

function validatePrefix(prefix) {
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

function setupPrefixValidation(inputId, feedbackId, saveBtnId) {
    const input = document.getElementById(inputId);
    const feedback = document.getElementById(feedbackId);
    const saveBtn = saveBtnId ? document.getElementById(saveBtnId) : null;
    if (!input) return;

    const runValidation = () => {
        const normalized = normalizePrefixInput(input.value);
        if (input.value !== normalized) {
            input.value = normalized;
        }
        const res = validatePrefix(input.value);
        if (feedback) {
            feedback.textContent = res.message;
            feedback.className = `form-feedback ${res.valid ? 'valid' : 'invalid'}`;
        }
        input.classList.toggle('is-valid', res.valid);
        input.classList.toggle('is-invalid', !res.valid);
        if (saveBtn) saveBtn.disabled = !res.valid;
    };

    input.addEventListener('input', runValidation);
    input.addEventListener('paste', () => setTimeout(runValidation, 0));
    runValidation();
}

// Инициализация при загрузке страницы
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new BotDashboard();
    dashboard.fetchStatus();
    
    if (window.location.pathname === '/triggers') {
        dashboard.loadTriggers();
    }

    if (window.location.pathname === '/settings') {
        setupPrefixValidation('prefix', 'prefixFeedback');
    }
});
