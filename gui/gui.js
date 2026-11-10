const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Адрес веб-панели бота (web_interface.js слушает 3005)
function getPanelUrl() {
    if (process.env.PANEL_URL) return process.env.PANEL_URL;
    let port = 3005;
    let host = '127.0.0.1';
    if (process.env.PANEL_PORT) {
        const p = parseInt(process.env.PANEL_PORT, 10);
        if (p > 0) port = p;
    }
    const configPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(configPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg) {
                if (cfg.panelPort && !process.env.PANEL_PORT) {
                    const p = parseInt(cfg.panelPort, 10);
                    if (p > 0) port = p;
                }
                if (cfg.panelHost) host = cfg.panelHost;
            }
        } catch (e) {}
    }
    return `http://${host}:${port}`;
}

const PANEL_URL = getPanelUrl();
const { spawn } = require('child_process');

class TelegramBotGUI {
    constructor() {
        this.mainWindow = null;
        this.tray = null;
        this.botProcess = null;
        this.isBotRunning = false;
        this.app = app;
        
        // Добавляем свойство isQuitting к app
        this.app.isQuitting = false;
        
        this.initApp();
    }

    initApp() {
        this.app.whenReady().then(() => {
            this.createWindow();
            this.createTray();
            this.setupIPC();

            this.app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    this.createWindow();
                }
            });
        });

        this.app.on('window-all-closed', () => {
            if (!this.tray) this.app.quit();
        });

        this.app.on('before-quit', () => {
            this.stopBot();
        });
    }

    createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            minWidth: 800,
            minHeight: 600,
            icon: path.join(__dirname, 'assets/icon.ico'),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            title: 'lpbot - Telegram Client',
            show: false
        });

        // Исправлено: используем this.mainWindow вместо mainWindow
        this.mainWindow.loadFile(path.join(__dirname, 'gui.html'));
        
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
        });

        this.mainWindow.on('close', (e) => {
            // Без иконки в трее спрятанное окно не вернуть, поэтому закрываем приложение
            if (!this.tray) {
                this.app.isQuitting = true;
                this.app.quit();
                return;
            }
            if (!this.app.isQuitting) {
                e.preventDefault();
                this.mainWindow.hide();
            }
        });
    }

    createTray() {
        try {
            const iconPath = path.join(__dirname, 'assets', 'icon.ico');
            if (!fs.existsSync(iconPath)) {
                console.warn('Иконка трея не найдена, трей отключён:', iconPath);
                return;
            }
            this.tray = new Tray(iconPath);
            
            const contextMenu = Menu.buildFromTemplate([
                {
                    label: 'Показать',
                    click: () => {
                        if (this.mainWindow) {
                            this.mainWindow.show();
                        }
                    }
                },
                {
                    label: 'Запустить бота',
                    type: 'checkbox',
                    checked: false,
                    click: (item) => {
                        if (item.checked) {
                            this.startBot();
                        } else {
                            this.stopBot();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Выход',
                    click: () => {
                        this.app.isQuitting = true;
                        this.app.quit();
                    }
                }
            ]);

            this.tray.setContextMenu(contextMenu);
            this.tray.setToolTip('lpbot - Telegram Client');
            
            this.tray.on('double-click', () => {
                if (this.mainWindow) {
                    this.mainWindow.show();
                }
            });
        } catch (error) {
            console.error('Ошибка создания tray:', error);
        }
    }

    setupIPC() {
        // Регистрируем обработчики IPC
        ipcMain.handle('start-bot', () => {
            return this.startBot();
        });

        ipcMain.handle('stop-bot', () => {
            return this.stopBot();
        });

        ipcMain.handle('get-bot-status', () => {
            return this.isBotRunning;
        });

        // Дополнительные обработчики для GUI
        ipcMain.handle('minimize-window', () => {
            if (this.mainWindow) {
                this.mainWindow.minimize();
            }
        });

        ipcMain.handle('close-window', () => {
            if (this.mainWindow) {
                if (this.tray) this.mainWindow.hide();
                else this.mainWindow.close();
            }
        });

        // Запросы к веб-панели бота идут из main-процесса, чтобы не упираться в CORS
        ipcMain.handle('panel-request', async (event, { method = 'GET', url, body }) => {
            try {
                let token = process.env.PANEL_TOKEN || '';
                let configPath = path.join(__dirname, '..', 'config.json');
                try {
                    const paths = require('../paths.js');
                    if (paths && paths.CONFIG_PATH) configPath = paths.CONFIG_PATH;
                } catch (e) {}
                if (!token && fs.existsSync(configPath)) {
                    try {
                        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        token = cfg.panelToken || '';
                    } catch (e) {}
                }
                const headers = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;
                if (body) headers['Content-Type'] = 'application/json';

                const response = await fetch(PANEL_URL + url, {
                    method,
                    headers: Object.keys(headers).length ? headers : undefined,
                    body: body ? JSON.stringify(body) : undefined
                });
                return { ok: response.ok, data: await response.json() };
            } catch (error) {
                return { ok: false, data: { success: false, message: 'Веб-панель бота недоступна: ' + error.message } };
            }
        });
    }

    startBot() {
        if (this.isBotRunning) {
            return { success: false, message: 'Бот уже запущен' };
        }

        try {
            // Запуск через модульное ядро main.js
            const botEntry = path.join(__dirname, '..', 'main.js');
            // Если запущено внутри Electron, используем встроенный Node.js рантайм через ELECTRON_RUN_AS_NODE=1
            const isElectron = Boolean(process.versions && process.versions.electron);
            const executable = isElectron ? process.execPath : 'node';
            const spawnEnv = { ...process.env };
            if (isElectron) {
                spawnEnv.ELECTRON_RUN_AS_NODE = '1';
            }

            this.botProcess = spawn(executable, [botEntry], {
                cwd: path.join(__dirname, '..'),
                env: spawnEnv,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false
            });

            this.isBotRunning = true;

            this.botProcess.stdout.on('data', (data) => {
                const log = data.toString().trim();
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('bot-log-update', {
                        type: 'info',
                        message: log,
                        timestamp: new Date().toLocaleTimeString()
                    });
                }
            });

            this.botProcess.stderr.on('data', (data) => {
                const error = data.toString().trim();
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('bot-log-update', {
                        type: 'error',
                        message: error,
                        timestamp: new Date().toLocaleTimeString()
                    });
                }
            });

            this.botProcess.on('close', (code) => {
                this.isBotRunning = false;
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('bot-log-update', {
                        type: 'warning',
                        message: `Бот завершил работу с кодом: ${code}`,
                        timestamp: new Date().toLocaleTimeString()
                    });
                }
                this.updateTrayMenu();
            });

            this.updateTrayMenu();
            return { success: true, message: 'Бот запущен' };

        } catch (error) {
            this.isBotRunning = false;
            if (this.mainWindow) {
                this.mainWindow.webContents.send('bot-log-update', {
                    type: 'error',
                    message: `Ошибка запуска: ${error.message}`,
                    timestamp: new Date().toLocaleTimeString()
                });
            }
            return { 
                success: false, 
                message: `Ошибка запуска: ${error.message}` 
            };
        }
    }

    stopBot() {
        if (!this.isBotRunning || !this.botProcess) {
            return { success: false, message: 'Бот не запущен' };
        }

        try {
            this.botProcess.kill('SIGTERM');
            this.isBotRunning = false;
            this.botProcess = null;
            this.updateTrayMenu();
            
            return { success: true, message: 'Бот остановлен' };
        } catch (error) {
            return { 
                success: false, 
                message: `Ошибка остановки: ${error.message}` 
            };
        }
    }

    updateTrayMenu() {
        if (this.tray && !this.tray.isDestroyed()) {
            const contextMenu = Menu.buildFromTemplate([
                {
                    label: 'Показать',
                    click: () => {
                        if (this.mainWindow) {
                            this.mainWindow.show();
                        }
                    }
                },
                {
                    label: this.isBotRunning ? 'Остановить бота' : 'Запустить бота',
                    type: 'checkbox',
                    checked: this.isBotRunning,
                    click: (item) => {
                        if (item.checked) {
                            this.startBot();
                        } else {
                            this.stopBot();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Выход',
                    click: () => {
                        this.app.isQuitting = true;
                        this.app.quit();
                    }
                }
            ]);

            this.tray.setContextMenu(contextMenu);
        }
    }
}

// Создаем экземпляр приложения
new TelegramBotGUI();