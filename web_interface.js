const express = require('express');
const path = require('path');
const WebSocket = require('ws');

class WebInterface {
    constructor(bot, db, port = 3001) {
        this.bot = bot;
        this.db = db;
        this.port = port;
        this.server = null;
        this.wss = null;
        
        // Инициализация Express
        this.app = express();
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Настройка EJS
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, 'views'));
        
        // Парсинг JSON и URL-encoded данных
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Статические файлы
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    setupRoutes() {
        // Главная страница
        this.app.get('/', (req, res) => {
            try {
                res.render('index', {
                    bot: this.bot,
                    stats: this.getStats(),
                    uptime: process.uptime()
                });
            } catch (error) {
                console.error('❌ Ошибка рендеринга главной страницы:', error);
                res.status(500).send('Ошибка сервера');
            }
        });

        // Страница шаблонов
        this.app.get('/templates', async (req, res) => {
            try {
                const templates = await this.db.getAllTemplates();
                const total = templates.length;
                
                res.render('templates', {
                    total: total,
                    templates: templates,
                    prefix: '!' // статический префикс
                });
            } catch (error) {
                console.error('❌ Ошибка загрузки шаблонов:', error);
                res.status(500).render('error', { error: 'Ошибка загрузки шаблонов' });
            }
        });

        // API для получения шаблонов
        this.app.get('/api/templates', async (req, res) => {
            try {
                const templates = await this.db.getAllTemplates();
                res.json({ templates });
            } catch (error) {
                console.error('❌ Ошибка API шаблонов:', error);
                res.status(500).json({ error: 'Ошибка загрузки шаблонов' });
            }
        });

        this.app.get('/settings', (req, res) => {
            res.render('settings', { bot: this.bot });
        });

        this.app.get('/triggers', (req, res) => {
            res.render('triggers', { bot: this.bot });
        });

        // Обработка 404
        this.app.use((req, res) => {
            res.status(404).render('404');
        });
    }

    getStats() {
        return {
            totalUsers: 0,
            activeTriggers: 0,
            totalMessages: 0,
            uptime: process.uptime()
        };
    }

    async start() {
        try {
            await new Promise((resolve, reject) => {
                this.server = this.app.listen(this.port, (err) => {
                    if (err) return reject(err);
                    console.log(`🌐 Веб-интерфейс запущен на порту ${this.port}`);
                    resolve();
                });
            });
            
            // Запуск WebSocket сервера
            this.startWebSocket();
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка запуска веб-интерфейса:', error);
            return false;
        }
    }

    startWebSocket() {
        this.wss = new WebSocket.Server({ server: this.server });
        
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log('🌐 Веб-интерфейс остановлен');
        }
        if (this.wss) {
            this.wss.close();
            console.log('🔌 WebSocket сервер остановлен');
        }
    }

    // Метод для отправки уведомлений через WebSocket
    broadcast(data) {
        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        }
    }
}

module.exports = WebInterface;