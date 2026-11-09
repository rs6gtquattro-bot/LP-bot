const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
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

        this.app.on('window-all-closed', (e) => {
            e.preventDefault();
            if (this.mainWindow) {
                this.mainWindow.hide();
            }
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
            if (!this.app.isQuitting) {
                e.preventDefault();
                this.mainWindow.hide();
            }
        });
    }

    createTray() {
        try {
            const iconPath = path.join(__dirname, 'assets', 'icon.ico');
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
                this.mainWindow.hide();
            }
        });
    }

    startBot() {
        if (this.isBotRunning) {
            return { success: false, message: 'Бот уже запущен' };
        }

        try {
            // Используем правильный путь к script.js (на уровень выше в profilesbot)
            const scriptPath = path.join(__dirname, '..', 'script.js');
            this.botProcess = spawn('node', [scriptPath], {
                cwd: path.join(__dirname, '..'), // Рабочая директория - profilesbot
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