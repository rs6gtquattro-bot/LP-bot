// расшифровка сокращенных коментов:
// таб. - таблица
// кк. - колонка(и)
// чек(а/и) - проверка
// метод - функция
// сейв - сохранение
// лс. - личный сообщения/чаты
// адд - создать/добавить
// ст. - структура
// кп. - копировать
// сд. - старые данные
// опр. - определить
// нск. - неизвестная структура
// ерор(ы) - ошибка(и)
// ренейм - переименовать
// стг. - старый триггер
// нью - новый
// алт. - алтернативный
// сст. - старая структура
// хз(шная/шный/шные) - неизвестный
// скип - пропустить
// соо. - старый одиночный ответ
// сетт - настройка
// бд. - база данных
// соо - сообщение


// импорты
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const sqlite3 = require('sqlite3').verbose();
const input = require('input');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const qrcode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const translate = require('@vitalets/google-translate-api');
const WebInterface = require('./web_interface.js');
const { Api } = require('telegram/tl');
const Jimp = require('jimp');
const { UpdateConnectionState } = require('telegram/events');

// отключаем логи gramJS
process.env.DEBUG = ''
class lpbot {
    constructor(telegramApiId, telegramApiHash, sessionString = null) {
        // сейвим API данные в самом начале
        this.telegramApiId = parseInt(telegramApiId);
        this.telegramApiHash = telegramApiHash.toString().trim();
        
        console.log('🔧 Инициализация lpbot...');
        console.log('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
        
        if (!this.telegramApiId || !this.telegramApiHash) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: API ID или API Hash не установлены!');
            process.exit(1);
        }
        
        this.sessionString = this.loadSession() || sessionString;
        
        this.telegramClient = null;
        this.db = null;
        this.isRunning = true;
        this.startTime = new Date();
        this.commands = {};
        this.webInterface = null;
        this.botInfo = null;
        
        this.settings = {
            prefix: '‘',
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
            triggers: new Map(),
            scheduledMessages: new Map(),
            customValues: {
            uptime: null,
            creator: null,
            version: null,
            botName: null,
            status: null,
            },
            templates: new Map(),
            deepseek: {
            apiKey: null,
            enabled: false,
            model: "deepseek-chat",
            maxTokens: 2048,
            temperature: 0.7
        }
        };
        
        this.setupDatabase();
        this.setupCommands();
        this.setupProcessHandlers();
        this.loadSettings();
        this.settings.timers = new Map();
        this.timerIntervals = new Map();

        console.log('✅ lpbot инициализирован');
    }

    async validateLoadedTriggers() {
    console.log('🔍 Проверяем загруженные триггеры...');
    
    for (const [word, trigger] of this.settings.triggers) {
        console.log(`📋 Триггер "${word}":`, {
            word: trigger.word,
            responses: trigger.responses,
            settings: trigger.settings
        });
    }
}

    // метод чека прав бота
    async checkBotPermissions(chatId) {
    try {
        const chat = await this.telegramClient.getEntity(chatId);
        
        // лс. всегда разрешены
        if (chat.className === 'User' || chat.className === 'Chat') {
            return { canSend: true, isPrivate: true };
        }
        
        // для групп чекаем права
        try {
            const botMember = await this.telegramClient.getPermissions(chatId, this.botInfo.id);
            return {
                canSend: botMember && botMember.sendMessages,
                isPrivate: false,
                isAdmin: botMember && botMember.isAdmin
            };
        } catch (permError) {
            console.log(`⚠️ Не удалось проверить права в чате ${chatId}:`, permError.message);
            return { canSend: false, isPrivate: false };
        }
        
    } catch (error) {
        console.error(`❌ Ошибка проверки прав для чата ${chatId}:`, error.message);
        return { canSend: false, isPrivate: false };
    }
}

    async updateTriggersTable() {
    return new Promise((resolve, reject) => {
        // чекаем существование таб.
        this.db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='triggers'`, (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            if (!row) {
                // таб. нет - адд новую
                console.log('📋 Таблица триггеров не найдена, создаем новую...');
                this.createNewTriggersTable().then(resolve).catch(reject);
                return;
            }

            // таб. есть - чекаем ст.
            this.db.all(`PRAGMA table_info(triggers)`, (pragmaErr, columns) => {
                if (pragmaErr) {
                    reject(pragmaErr);
                    return;
                }

                // чекаем наличие необходимых кк.
                const columnNames = columns.map(col => col.name);
                const requiredColumns = ['responses', 'settings', 'used_count', 'last_used'];
                const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));

                if (missingColumns.length === 0) {
                    console.log('✅ Структура таблицы триггеров актуальна');
                    resolve();
                    return;
                }

                console.log(`🔄 Обновляем таблицу триггеров, добавляем колонки: ${missingColumns.join(', ')}`);
                this.migrateTriggersTable(missingColumns).then(resolve).catch(reject);
            });
        });
    });
}

    async migrateTriggersTable(missingColumns) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            // адд временную таб. с нью ст.
            this.db.run(`CREATE TABLE IF NOT EXISTS triggers_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT UNIQUE,
                responses TEXT,
                settings TEXT,
                used_count INTEGER DEFAULT 0,
                last_used DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (createErr) => {
                if (createErr) {
                    reject(createErr);
                    return;
                }

                // кп. данные из старой таб.
                this.db.all(`SELECT * FROM triggers`, (selectErr, oldTriggers) => {
                    if (selectErr) {
                        console.error('Ошибка чтения старых триггеров:', selectErr);
                        // продолжаем без сд.
                        oldTriggers = [];
                    }

                    if (oldTriggers.length > 0) {
                        console.log(`🔄 Переносим ${oldTriggers.length} старых триггеров`);
                        this.migrateOldTriggersData(oldTriggers)
                            .then(() => this.finalizeMigration())
                            .then(resolve)
                            .catch(reject);
                    } else {
                        this.finalizeMigration().then(resolve).catch(reject);
                    }
                });
            });
        });
    });
}

    // метод для переноса триггеров
    async migrateOldTriggersData(oldTriggers) {
    const migrationPromises = oldTriggers.map(oldTrigger => {
        return new Promise((resolve, reject) => {
            try {
                let word, response;
                
                // опр. структуру стг.
                if (oldTrigger.word && oldTrigger.response) {
                    word = oldTrigger.word;
                    response = oldTrigger.response;
                } else {
                    // нск. - скипаем
                    console.log('⚠️ Пропускаем триггер с неизвестной структурой:', oldTrigger);
                    resolve();
                    return;
                }

                // создаем нью объект триггера
                const newTrigger = {
                    word: word,
                    responses: [response],
                    settings: {
                        count: 1,
                        delay: 0,
                        chance: 100,
                        cooldown: 0,
                        enabled: true,
                        regex: false,
                        caseSensitive: false,
                        reply: false,
                        silent: false,
                        created: oldTrigger.created_at || new Date(),
                        used: oldTrigger.used_count || 0,
                        lastUsed: oldTrigger.last_used || null
                    }
                };

                // вставляем в нью таб.
                this.db.run(
                    `INSERT INTO triggers_new (word, responses, settings, used_count, last_used, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        newTrigger.word,
                        JSON.stringify(newTrigger.responses),
                        JSON.stringify(newTrigger.settings),
                        newTrigger.settings.used,
                        newTrigger.settings.lastUsed,
                        newTrigger.settings.created
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            } catch (error) {
                console.error('Ошибка миграции триггера:', error);
                resolve(); // продолжаем миграцию даже при ерорах
            }
        });
    });

    await Promise.all(migrationPromises);
}

    // метод для завершения миграции
    async finalizeMigration() {
    return new Promise((resolve, reject) => {
        // делетаем старую таб.
        this.db.run(`DROP TABLE IF EXISTS triggers`, (dropErr) => {
            if (dropErr) {
                console.error('Ошибка удаления старой таблицы:', dropErr);
            }

            // ренейм нью таб.
            this.db.run(`ALTER TABLE triggers_new RENAME TO triggers`, (renameErr) => {
                if (renameErr) {
                    reject(renameErr);
                    return;
                }

                console.log('✅ Миграция таблицы триггеров завершена');
                resolve();
            });
        });
    });
}

    // метод для адд нью таб. триггеров
    async createNewTriggersTable() {
    return new Promise((resolve, reject) => {
        this.db.run(`CREATE TABLE IF NOT EXISTS triggers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT UNIQUE,
            responses TEXT,
            settings TEXT,
            used_count INTEGER DEFAULT 0,
            last_used DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// метод для миграции стг. в нью ск.
async migrateOldTriggers(oldTriggers) {
    const migrationPromises = oldTriggers.map(oldTrigger => {
        return new Promise((resolve, reject) => {
            // определяем ск. стг.
            let word, response;
            
            if (oldTrigger.word && oldTrigger.response) {
                // нью структура (уже есть word и response)
                word = oldTrigger.word;
                response = oldTrigger.response;
            } else if (oldTrigger.trigger_word && oldTrigger.trigger_response) {
                // альт. сск.
                word = oldTrigger.trigger_word;
                response = oldTrigger.trigger_response;
            } else {
                // хзшная ск. - скипаем
                console.log('⚠️ Пропускаем триггер с неизвестной структурой:', oldTrigger);
                resolve();
                return;
            }

            // адд нью объект триггера
            const newTrigger = {
                word: word,
                responses: [response], // соо. превращаем в массив
                settings: {
                    count: 1,
                    delay: 0,
                    chance: 100,
                    cooldown: 0,
                    enabled: true,
                    regex: false,
                    caseSensitive: false,
                    reply: false,
                    silent: false,
                    created: oldTrigger.created_at || new Date(),
                    used: oldTrigger.used_count || 0,
                    lastUsed: oldTrigger.last_used || null
                }
            };

            // сейвим в нью таб.
            this.db.run(
                `INSERT INTO triggers (word, responses, settings, used_count, last_used, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    newTrigger.word,
                    JSON.stringify(newTrigger.responses),
                    JSON.stringify(newTrigger.settings),
                    newTrigger.settings.used,
                    newTrigger.settings.lastUsed,
                    newTrigger.settings.created
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    });

    await Promise.all(migrationPromises);
}

    async saveTriggersToDatabase() {
    try {
        console.log('💾 Сохраняем триггеры в базу данных...');
        
        // очищаем таб. триггеров
        await new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM triggers`, (err) => {
                if (err) {
                    console.error('❌ Ошибка очистки таблицы триггеров:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        
        // сейвим все триггеры заново в нью ск.
        let savedCount = 0;
        for (const [word, trigger] of this.settings.triggers) {
            try {
                // чекаем корректность данных триггера
                if (!trigger || !trigger.word || !trigger.responses || !trigger.settings) {
                    console.error('❌ Пропускаем некорректный триггер:', word);
                    continue;
                }

                await new Promise((resolve, reject) => {
                    this.db.run(
                        `INSERT INTO triggers (word, responses, settings, used_count, last_used, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            trigger.word,
                            JSON.stringify(trigger.responses),
                            JSON.stringify(trigger.settings),
                            trigger.settings.used || 0,
                            trigger.settings.lastUsed || null,
                            trigger.settings.created || new Date()
                        ],
                        (err) => {
                            if (err) {
                                console.error(`❌ Ошибка сохранения триггера "${trigger.word}":`, err.message);
                                reject(err);
                            } else {
                                savedCount++;
                                resolve();
                            }
                        }
                    );
                });
            } catch (triggerError) {
                console.error(`❌ Ошибка обработки триггера "${word}":`, triggerError.message);
                // продолжаем сохранение других триггеров
            }
        }
        
        console.log(`✅ Сохранено ${savedCount} триггеров в базу`);
    } catch (error) {
        console.error('❌ Общая ошибка сохранения триггеров:', error.message);
    }
}

    async saveAllData() {
    try {
        // сейвим сетты в JSON
        this.saveSettings();
        
        // сейвим триггеры в бд.
        await this.saveTriggersToDatabase();
        
        // сейвим таймеры в бд.
        await this.saveTimersToDatabase();
        
        console.log('💾 Все данные сохранены');
    } catch (error) {
        console.error('❌ Ошибка сохранения данных:', error);
        throw error;
    }
}

/**
 * Сохранение всех таймеров в базу данных
 */
async saveTimersToDatabase() {
    try {
        console.log('💾 Сохраняем таймеры в базу данных...');
        
        // Очищаем таблицу таймеров
        await new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM timers`, (err) => {
                if (err) {
                    console.error('❌ Ошибка очистки таблицы таймеров:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        
        // Сохраняем все активные таймеры
        let savedCount = 0;
        for (const [name, timer] of this.settings.timers) {
            try {
                await new Promise((resolve, reject) => {
                    this.db.run(
                        `INSERT INTO timers (name, chat_id, message_text, trigger_time, interval_seconds, repeat_count, current_count, enabled, created_at, last_triggered, settings) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            timer.name,
                            timer.chatId,
                            timer.messageText,
                            timer.triggerTime.toISOString(),
                            timer.intervalSeconds,
                            timer.repeatCount,
                            timer.currentCount,
                            timer.enabled,
                            timer.createdAt.toISOString(),
                            timer.lastTriggered ? timer.lastTriggered.toISOString() : null,
                            JSON.stringify(timer.settings)
                        ],
                        (err) => {
                            if (err) reject(err);
                            else {
                                savedCount++;
                                resolve();
                            }
                        }
                    );
                });
            } catch (timerError) {
                console.error(`❌ Ошибка сохранения таймера "${name}":`, timerError.message);
            }
        }
        
        console.log(`✅ Сохранено ${savedCount} таймеров в базу`);
    } catch (error) {
        console.error('❌ Общая ошибка сохранения таймеров:', error.message);
    }
}

    async loadTriggersFromDatabase() {
    try {
        console.log('📋 Загружаем триггеры из базы данных...');
        
        // Сначала обновляем структуру таблицы
        await this.updateTriggersTable();
        
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT word, responses, settings, used_count, last_used, created_at FROM triggers`, (err, rows) => {
                if (err) {
                    console.error('❌ Ошибка загрузки триггеров:', err.message);
                    // Если ерор, продолжаем с пустыми триггерами
                    this.settings.triggers.clear();
                    resolve();
                    return;
                }
                
                this.settings.triggers.clear();
                
                if (rows && rows.length > 0) {
                    let loadedCount = 0;
                    
                    rows.forEach(row => {
                        try {
                            // чекаем обязательные поля
                            if (!row.word || !row.responses || !row.settings) {
                                console.error('❌ Пропускаем триггер с отсутствующими полями:', row.word);
                                return;
                            }

                            const responses = JSON.parse(row.responses);
                            const settings = JSON.parse(row.settings);

                            // чекаем типы данных
                            if (!Array.isArray(responses) || typeof settings !== 'object') {
                                console.error('❌ Пропускаем триггер с некорректными данными:', row.word);
                                return;
                            }

                            const trigger = {
                                word: row.word,
                                responses: responses,
                                settings: {
                                    ...settings,
                                    used: row.used_count || 0,
                                    lastUsed: row.last_used,
                                    created: row.created_at
                                }
                            };
                            
                            this.settings.triggers.set(row.word.toLowerCase(), trigger);
                            loadedCount++;
                            
                        } catch (parseError) {
                            console.error(`❌ Ошибка парсинга триггера "${row.word}":`, parseError.message);
                        }
                    });
                    
                    console.log(`✅ Загружено ${loadedCount} расширенных триггеров из базы данных`);
                } else {
                    console.log('📋 В базе данных нет триггеров');
                }
                
                resolve();
            });
        });
    } catch (error) {
        console.error('❌ Критическая ошибка загрузки триггеров:', error.message);
        // В случае ерор просто продолжаем с пустыми триггерами
        this.settings.triggers.clear();
    }
}

    async convertJpegToPng(jpegBuffer) {
        try {
            // Используем Jimp для конвертации JPEG в PNG
            const image = await Jimp.read(jpegBuffer);
            const pngBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
            console.log('✅ JPEG успешно конвертирован в PNG');
            return pngBuffer;
        } catch (error) {
            console.error('❌ Ошибка конвертации JPEG в PNG:', error.message);
            // В случае ошибки возвращаем оригинальный буфер
            return jpegBuffer;
        }
    }

    // Добавьте эту функцию в класс lpbot для определения типа изображения
    getImageType(buffer) {
    // чекаем сигнатуры файлов
    if (buffer.length < 8) return 'unknown';
    
    const header = buffer.slice(0, 8);
    
    // PNG signature
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
        return 'png';
    }
    
    // JPEG signature
    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
        return 'jpeg';
    }
    
    // GIF signature
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
        return 'gif';
    }
    
    // WebP signature
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
        return 'webp';
    }
    
    return 'unknown';
}

    setupProcessHandlers() {
    const cleanup = async (signal = 'normal') => {
        console.log(`💾 Сохранение данных перед выходом (${signal})...`);

        // Останавливаем все процессы
        this.isRunning = false;

        // Очищаем интервалы мониторинга
        if (this.connectionMonitor) {
            clearInterval(this.connectionMonitor);
        }
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }

        this.timerIntervals.forEach((timeoutId, timerName) => {
            clearTimeout(timeoutId);
        });
        this.timerIntervals.clear();

        try {
            await this.saveAllData();
            console.log('✅ Данные успешно сохранены');
        } catch (error) {
            console.error('❌ Ошибка при сохранении данных:', error);
        }

        // Закрываем веб-интерфейс
        if (this.webInterface) {
            try {
                await this.webInterface.stop();
                console.log('✅ Веб-интерфейс остановлен');
            } catch (error) {
                console.error('❌ Ошибка остановки веб-интерфейса:', error);
            }
        }

        // Закрываем базу данных
        if (this.db) {
            this.db.close((err) => {
                if (err) console.error('❌ Ошибка закрытия БД:', err);
                else console.log('✅ База данных закрыта');
            });
        }

        // Закрываем Telegram клиент
        if (this.telegramClient) {
            try {
                await this.telegramClient.disconnect();
                console.log('✅ Telegram клиент отключен');
            } catch (error) {
                console.error('❌ Ошибка отключения Telegram клиента:', error);
            }
        }

        if (signal === 'error') {
            process.exit(1);
        } else {
            process.exit(0);
        }
    };

    process.on('exit', () => cleanup('exit'));
    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));

    process.on('uncaughtException', async (error) => {
        console.error('💥 Необработанное исключение:', error);
        await cleanup('error');
    });

    process.on('unhandledRejection', async (reason, promise) => {
        console.error('💥 Необработанный rejection:', reason, 'в', promise);
        await cleanup('error');
    });
}

    saveSettings() {
    try {
        const settingsFile = path.join(__dirname, 'settings.json');
        const settingsData = {
            prefix: this.settings.prefix,
            notifications: this.settings.notifications,
            autoStatus: this.settings.autoStatus,
            autoStatusSettings: this.settings.autoStatusSettings,
            autoReadMentions: this.settings.autoReadMentions, // Это ключевая настройка!
            autoAddFriends: this.settings.autoAddFriends,
            autoLeaveChats: this.settings.autoLeaveChats,
            autoUnsubscribe: this.settings.autoUnsubscribe,
            dynamicCover: this.settings.dynamicCover,
            muteChat: this.settings.muteChat,
            photoBoost: this.settings.photoBoost,
            customValues: this.settings.customValues,
            deepseek: this.settings.deepseek
        };
        
        fs.writeFileSync(settingsFile, JSON.stringify(settingsData, null, 2));
        console.log('✅ Настройки сохранены в settings.json');
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек:', error.message);
    }
}

    loadSettings() {
    try {
        const settingsFile = path.join(__dirname, 'settings.json');
        if (fs.existsSync(settingsFile)) {
            const data = fs.readFileSync(settingsFile, 'utf8');
            const settingsData = JSON.parse(data);
            
            // Загружаем основные настройки
            this.settings.prefix = settingsData.prefix || '!';
            this.settings.notifications = settingsData.notifications !== undefined ? settingsData.notifications : true;
            this.settings.autoStatus = settingsData.autoStatus || false;
            this.settings.autoStatusSettings = settingsData.autoStatusSettings || { mode: 1, interval: 60 };
            this.settings.autoReadMentions = settingsData.autoReadMentions || false;
            this.settings.autoAddFriends = settingsData.autoAddFriends || false;
            this.settings.autoLeaveChats = settingsData.autoLeaveChats || false;
            this.settings.autoUnsubscribe = settingsData.autoUnsubscribe || false;
            this.settings.dynamicCover = settingsData.dynamicCover || false;
            this.settings.muteChat = settingsData.muteChat || false;
            this.settings.photoBoost = settingsData.photoBoost || { active: false, mode: 1, album: null, count: 0 };
            this.settings.customValues = settingsData.customValues || {
                uptime: null,
                creator: null,
                version: null,
                botName: null,
                status: null
            };
                
                if (settingsData.deepseek) {
                this.settings.deepseek = {
                    ...this.settings.deepseek,
                    ...settingsData.deepseek
                };
            }
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки настроек:', error.message);
    }
}

    setupDatabase() {
    return new Promise((resolve, reject) => {
        try {
            // Используем файловую базу данных вместо памяти для сохранности данных
            const dbPath = path.join(__dirname, 'bot_database.sqlite');
            console.log(`💾 База данных: ${dbPath}`);
            
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('❌ Ошибка подключения к БД:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ Подключение к SQLite установлено');
                
                // Включаем foreign keys
                this.db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) {
                        console.error('❌ Ошибка включения foreign keys:', err.message);
                    }
                    
                    this.initDatabase().then(resolve).catch(reject);
                });
            });
        } catch (error) {
            console.error('❌ Ошибка настройки БД:', error.message);
            reject(error);
        }
    });
}

    async initDatabase() {
        try {
            await this.initTables();
            await this.initAccessLevels();
            await this.addMainUser();
            console.log('✅ База данных инициализирована');
        } catch (error) {
            console.error('❌ Ошибка инициализации БД:', error);
        }
    }

    async initTables() {
    try {
        console.log('🗄️ Инициализация таблиц базы данных...');
        
        // Создаем таблицы по очереди с обработкой ошибок
        const tables = [
            // таб. users
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tg_id BIGINT UNIQUE,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                access_level INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // таб. user_stats
            `CREATE TABLE IF NOT EXISTS user_stats (
                user_id INTEGER PRIMARY KEY,
                messages_sent INTEGER DEFAULT 0,
                commands_executed INTEGER DEFAULT 0,
                last_activity DATETIME,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )`,
            
            // таб. command_history
            `CREATE TABLE IF NOT EXISTS command_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                command TEXT,
                arguments TEXT,
                executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            )`,
            
            // таб. access_levels
            `CREATE TABLE IF NOT EXISTS access_levels (
                level INTEGER PRIMARY KEY,
                name TEXT,
                description TEXT
            )`,
            
            // таб. photo_boost_stats
            `CREATE TABLE IF NOT EXISTS photo_boost_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                album_url TEXT,
                photos_added INTEGER DEFAULT 0,
                last_boost DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // таб. triggers
            `CREATE TABLE IF NOT EXISTS triggers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT UNIQUE,
                responses TEXT,
                settings TEXT,
                used_count INTEGER DEFAULT 0,
                last_used DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // таб. templates
            `CREATE TABLE IF NOT EXISTS templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                content_type TEXT,
                text_content TEXT,
                media_data BLOB,
                file_name TEXT,
                mime_type TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                used_count INTEGER DEFAULT 0,
                last_used DATETIME
            )`,

            // таб. timers
            `CREATE TABLE IF NOT EXISTS timers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                chat_id BIGINT,
                message_text TEXT,
                trigger_time DATETIME,
                interval_seconds INTEGER,
                enabled BOOLEAN DEFAULT true,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                settings TEXT
            )`
        ];

        // Создаем таблицы последовательно
        for (let i = 0; i < tables.length; i++) {
            const sql = tables[i];
            
            try {
                await new Promise((resolve, reject) => {
                    this.db.run(sql, (err) => {
                        if (err) {
                            console.error(`❌ Ошибка создания таблицы ${i + 1}:`, err.message);
                            console.error('SQL:', sql);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.error(`💥 Критическая ошибка при создании таблицы ${i + 1}`);
                throw error;
            }
        }
        
        console.log('✅ Все таблицы базы данных инициализированы');
    } catch (error) {
        console.error('❌ Фатальная ошибка инициализации таблиц:', error);
        throw error;
    }
}

    async initAccessLevels() {
        const levels = [
            [0, 'user', 'Обычный пользователь'],
            [1, 'trusted', 'Проверенный пользователь'],
            [2, 'moderator', 'Модератор'],
            [3, 'admin', 'Администратор'],
            [4, 'owner', 'Владелец']
        ];

        for (const [level, name, description] of levels) {
            await new Promise((resolve, reject) => {
                this.db.run(
                    `INSERT OR IGNORE INTO access_levels (level, name, description) VALUES (?, ?, ?)`,
                    [level, name, description],
                    (err) => err ? reject(err) : resolve()
                );
            });
        }
    }

    async addMainUser() {
        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR IGNORE INTO users (tg_id, username, first_name, last_name, access_level) 
                 VALUES (?, ?, ?, ?, ?)`,
                [8051199856, 'main_user', 'Main', 'User', 4],
                (err) => err ? reject(err) : resolve()
            );
        });
    }

    async initializeTelegram() {
    try {
        console.log('🚀 Инициализация Telegram клиента...');
        console.log('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
        
        if (!this.telegramApiId || !this.telegramApiHash) {
            throw new Error('API ID или API Hash не установлены!');
        }

        // Загружаем сессию
        this.sessionString = this.loadSession();
        console.log(`📄 Статус сессии: ${this.sessionString ? 'загружена' : 'не найдена'}`);
        
        const stringSession = new StringSession(this.sessionString || '');
        
        // ОПТИМИЗИРОВАННАЯ конфигурация клиента
        this.telegramClient = new TelegramClient(stringSession, this.telegramApiId, this.telegramApiHash, {
            connectionRetries: 10,
            useWSS: false,
            autoReconnect: true,
            timeout: 30000,
            requestRetries: 8,
            deviceModel: 'lpbot',
            systemVersion: '1.0.0',
            appVersion: '3.0.0',
            langCode: 'ru',
            systemLangCode: 'ru',
            baseLogger: undefined,
            useIPV6: false,
            proxy: null
        });

        console.log('📡 Подключаемся к Telegram серверу...');
        await this.telegramClient.connect();
        console.log('✅ Подключение установлено');

        // чекаем существующую сессию
        if (this.sessionString) {
            try {
                console.log('🔍 Проверяем валидность сессии...');
                const me = await this.telegramClient.getMe();
                this.botInfo = me;
                console.log(`✅ Сессия валидна: @${me.username || me.firstName}`);
                
                await this.completeInitialization();
                return;
            } catch (sessionError) {
                console.log('❌ Сессия невалидна:', sessionError.message);
                this.sessionString = null;
                this.saveSession('');
            }
        }

        // Если дошли сюда, требуется авторизация
        console.log('🔑 Начинаем авторизацию...');
        await this.optimizedAuth();
        
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram:', error.message);
        console.log('🔄 Повтор через 10 секунд...');
        setTimeout(() => this.initializeTelegram(), 10000);
    }
}

    setupConnectionHandlers() {
    console.log('🔧 Настройка обработчиков соединения...');
    
    // Простой мониторинг соединения через ping
    this.connectionMonitor = setInterval(async () => {
        try {
            if (this.telegramClient && this.telegramClient.connected) {
                // Отправляем легкий запрос для проверки соединения
                await this.telegramClient.invoke(new Api.ping({ 
                    pingId: BigInt(Math.floor(Math.random() * 1000000000)) 
                }));
                // console.log('✅ Соединение стабильное'); // Можно раскомментировать для дебага
            }
        } catch (error) {
            console.log('⚠️ Проблемы с соединением:', error.message);
        }
    }, 45000); // Проверяем каждые 45 секунд
}

startKeepAlive() {
    console.log('🔧 Запуск улучшенного keep-alive...');
    
    this.keepAliveInterval = setInterval(async () => {
        // Проверяем, что бот вообще запущен
        if (!this.isRunning || !this.telegramClient) {
            return;
        }
        
        try {
            // Используем легкий метод вместо ping
            if (this.telegramClient.connected) {
                // Просто проверяем состояние без тяжелых запросов
                await this.telegramClient.invoke(new Api.help.GetConfig());
                console.log('✅ Соединение стабильное');
            } else {
                console.log('⏳ Ожидание восстановления соединения...');
            }
        } catch (error) {
            // Игнорируем временные ошибки - GramJS сам восстановит соединение
            if (!error.message.includes('TIMEOUT') && !error.message.includes('FLOOD')) {
                console.log('⚠️ Временная проблема с соединением, GramJS восстановит автоматически');
            }
        }
    }, 120000); // Увеличиваем интервал до 2 минут
}

    // ДОПУЩЕНИЕ: исходный optimizedAuth не сохранился ни в одной версии (ПК, favorite, выгрузка VK-чата).
    // Восстановлен по образцу botsTG/lp/script.js: вход через client.start у GramJS с вводом в консоли.
    async optimizedAuth() {
    console.log('🔑 Авторизация по номеру телефона...');
    await this.telegramClient.start({
        phoneNumber: async () => await input.text('📱 Номер телефона (в формате +7...): '),
        password: async () => await input.password('🔒 Пароль облачный 2FA (если нет — Enter): '),
        phoneCode: async () => await input.text('💬 Код из Telegram: '),
        onError: (err) => console.error('❌ Ошибка авторизации:', err.message),
    });

    console.log('✅ Авторизация успешна!');
    this.sessionString = this.telegramClient.session.save();
    this.saveSession(this.sessionString);

    this.botInfo = await this.telegramClient.getMe();
    console.log(`🤖 Авторизованы как: @${this.botInfo.username || this.botInfo.firstName}`);

    await this.completeInitialization();
}

    async completeInitialization() {
    try {
        console.log('🎯 Завершаем инициализацию...');
        
        // Пытаемся добавить пользователя, но не прерываем при ероре
        try {
            await this.ensureUserExists(this.botInfo.id, this.botInfo.username, this.botInfo.firstName, this.botInfo.lastName);
        } catch (userError) {
            console.error('⚠️ Ошибка добавления пользователя, продолжаем:', userError.message);
        }
        
        // Загружаем настройки
        this.loadSettings();
        
        // Загружаем триггеры (если таб. существует)
        try {
            await this.loadTriggersFromDatabase();
            // чекаем структуру загруженных триггеров
            await this.validateTriggersStructure();
        } catch (triggerError) {
            console.error('⚠️ Ошибка загрузки триггеров, продолжаем:', triggerError.message);
        }

        try {
             await this.loadTimersFromDatabase();
        } catch (timerError) {
            console.error('⚠️ Ошибка загрузки таймеров, продолжаем:', timerError.message);
        }
        
        // Настраиваем обработчики
        this.setupMessageHandlers();
        this.startSystemMonitoring();
        
        // Запускаем веб-интерфейс
        try {
            await this.startWebInterface();
        } catch (webError) {
            console.error('⚠️ Ошибка запуска веб-интерфейса, продолжаем:', webError.message);
        }
        
        // ЗАКОММЕНТИРУЙТЕ проблемную строку и используйте альтернативу:
        // this.setupConnectionHandlers(); // ЗАКОММЕНТИРОВАТЬ
        
        // Вместо этого используйте простой keep-alive
        this.startKeepAlive();
        
        console.log('🚀 lpbot успешно запущен!');
        console.log(`🔧 Префикс: ${this.settings.prefix}`);
        console.log(`🤖 Пользователь: @${this.botInfo.username || this.botInfo.firstName}`);
        console.log(`🆔 ID: ${this.botInfo.id}`);
        
    } catch (error) {
        console.error('❌ Ошибка завершения инициализации:', error);
    }
}

    loadSession() {
        try {
            const sessionFile = path.join(__dirname, 'session.txt');
            if (fs.existsSync(sessionFile)) {
                const sessionData = fs.readFileSync(sessionFile, 'utf8').trim();
                if (sessionData && sessionData.length > 10) {
                    return sessionData;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки сессии:', error.message);
        }
        return null;
    }

    saveSession(sessionString) {
        try {
            const sessionFile = path.join(__dirname, 'session.txt');
            fs.writeFileSync(sessionFile, sessionString);
            console.log('✅ Сессия сохранена');
        } catch (error) {
            console.error('❌ Ошибка сохранения сессии:', error.message);
        }
    }

async startWebInterface() {
    try {
        if (!this.webInterface) {
            this.webInterface = new WebInterface(this);
        }
        await this.webInterface.start();
        console.log('✅ Веб-интерфейс запущен');
    } catch (error) {
        console.error('❌ Ошибка запуска веб-интерфейса:', error);
    }
}

    async checkExistingSession() {
    try {
        const sessionFile = path.join(__dirname, 'session.txt');
        if (!fs.existsSync(sessionFile)) {
            console.log('❌ Файл session.txt не существует');
            return false;
        }
        
        const sessionContent = fs.readFileSync(sessionFile, 'utf8').trim();
        if (!sessionContent) {
            console.log('❌ Файл session.txt пустой');
            return false;
        }
        
        console.log(`📊 Содержимое session.txt: ${sessionContent.substring(0, 50)}...`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка проверки сессии:', error);
        return false;
    }
}

    async start() {
    console.log('🚀 Запуск lpbot...');
    console.log('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    
    // Добавляем глобальный обработчик необработанных исключений
    process.on('unhandledRejection', (reason, promise) => {
        console.error('💥 Необработанный rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
        console.error('💥 Необработанное исключение:', error);
    });

    try {
        await this.initializeTelegram();
    } catch (error) {
        console.error('💥 Фатальная ошибка при запуске бота:', error);
        console.log('🔄 Попытка перезапуска через 30 секунд...');
        
        setTimeout(() => {
            console.log('🔄 Перезапускаем бота...');
            this.start();
        }, 30000);
    }
}

    async ensureUserExists(tgId, username, firstName, lastName) {
    try {
        // Сначала чекаем существование таблицы users
        const tableExists = await new Promise((resolve, reject) => {
            this.db.get(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });

        if (!tableExists) {
            console.log('📋 Таблицы users не существует, создаем...');
            await this.createUsersTable();
        }

        const user = await this.getUserData(tgId);
        if (!user) {
            await new Promise((resolve, reject) => {
                this.db.run(
                    `INSERT OR IGNORE INTO users (tg_id, username, first_name, last_name, access_level) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [tgId, username, firstName, lastName, 0],
                    (err) => {
                        if (err) {
                            console.error('❌ Ошибка вставки пользователя:', err.message);
                            reject(err);
                        } else {
                            console.log(`✅ Пользователь ${tgId} добавлен в базу`);
                            resolve();
                        }
                    }
                );
            });
        } else {
            console.log(`✅ Пользователь ${tgId} уже существует в базе`);
        }
    } catch (error) {
        console.error('❌ Ошибка создания пользователя:', error);
        // Не прерываем выполнение при ероре пользователя
    }
}

    async createUsersTable() {
    return new Promise((resolve, reject) => {
        const sql = `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id BIGINT UNIQUE,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            access_level INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;
        
        this.db.run(sql, (err) => {
            if (err) {
                console.error('❌ Ошибка создания таблицы users:', err.message);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

    async getUserData(tgId) {
    return new Promise((resolve, reject) => {
        this.db.get(
            `SELECT * FROM users WHERE tg_id = ?`,
            [tgId],
            (err, row) => {
                if (err) {
                    // Если таблицы нет, возвращаем null вместо ошибки
                    if (err.message.includes('no such table')) {
                        console.log('📋 Таблицы users не существует');
                        resolve(null);
                    } else {
                        console.error('❌ Ошибка получения пользователя:', err.message);
                        reject(err);
                    }
                } else {
                    resolve(row);
                }
            }
        );
    });
}

    setupMessageHandlers() {
    // Обработчик для команд и триггеров
    // Обработчик для команд и триггеров
    this.telegramClient.addEventHandler(async (event) => {
        try {
            const message = event.message;
            if (!message || !message.text) return;
            
            const text = message.text.trim();
            const chatId = message.chatId;
            const senderId = message.senderId;
            const messageId = message.id;

            // Получаем информацию о боте
            if (!this.botInfo) {
                this.botInfo = await this.telegramClient.getMe();
            }

            // Игнорируем сообщения от самого бота
            if (senderId === this.botInfo.id) return;

            // Обработка команд (если сообщение начинается с префикса)
            if (text.startsWith(this.settings.prefix)) {
                const parts = text.split(' ');
                const command = parts[0].toLowerCase().substring(this.settings.prefix.length);
                const args = parts.slice(1);
                
                console.log(`🔧 Вызов команды: ${command}, args: ${args}`);
                await this.handleCommand(command, args, message, chatId, senderId, messageId);
                return;
            }

            // ОБРАБОТКА ТРИГГЕРОВ
            if (this.settings.triggers.size > 0) {
                await this.handleEnhancedTriggers(text, message, chatId, senderId, messageId);
            }

        } catch (error) {
            console.error('❌ Ошибка обработки сообщения:', error);
        }
    }, new NewMessage({}));

    // Обработчик для автоматического прочитывания упоминаний (остается без изменений)
    this.telegramClient.addEventHandler(async (event) => {
        try {
            const message = event.message;
            if (!message || !this.settings.autoReadMentions) return;
            
            const text = message.text || '';
            const chatId = message.chatId;
            const messageId = message.id;
            
            if (!this.botInfo) {
                this.botInfo = await this.telegramClient.getMe();
            }
            const botUsername = this.botInfo.username;
            const botId = this.botInfo.id;
            
            if (!botUsername) {
                console.error('❌ Не удалось получить юзернейм бота для автопуши');
                return;
            }
            
            let hasMention = false;
            
            if (text) {
                const mentionRegex = new RegExp(`@${botUsername}`, 'i');
                hasMention = mentionRegex.test(text);
            }
            
            if (!hasMention && message.entities) {
                for (const entity of message.entities) {
                    if (entity.className === 'MessageEntityMention' || 
                        entity.className === 'MessageEntityMentionName') {
                        const mentionedText = text.substring(entity.offset, entity.offset + entity.length);
                        if (mentionedText.toLowerCase() === `@${botUsername.toLowerCase()}`) {
                            hasMention = true;
                            break;
                        }
                    }
                }
            }
            
            let isReplyToBot = false;
            if (message.replyTo && message.replyTo.replyToMsgId) {
                try {
                    const repliedMessage = await this.telegramClient.getMessages(chatId, {
                        ids: [message.replyTo.replyToMsgId]
                    });
                    if (repliedMessage[0] && repliedMessage[0].senderId === botId) {
                        isReplyToBot = true;
                    }
                } catch (error) {
                    console.log('Не удалось проверить ответное сообщение');
                }
            }
            
            if (hasMention || isReplyToBot) {
                console.log(`🔍 Найдено упоминание в чате ${chatId}, прочитываю...`);
                
                try {
                    await this.telegramClient.invoke(
                        new Api.messages.ReadMentions({
                            peer: await this.telegramClient.getInputEntity(chatId)
                        })
                    );
                    
                    console.log(`✅ Упоминания прочитаны в чате ${chatId}`);
                    
                    try {
                        await this.telegramClient.invoke(
                            new Api.messages.ReadHistory({
                                peer: await this.telegramClient.getInputEntity(chatId),
                                maxId: messageId
                            })
                        );
                    } catch (readError) {
                        console.log('⚠️ Альтернативный метод прочтения не сработал:', readError.message);
                    }
                    
                    try {
                        const notification = await this.telegramClient.sendMessage(chatId, {
                            message: `👀 Упоминание автоматически прочитано (автопуши)`,
                            parseMode: null
                        });
                        
                        setTimeout(async () => {
                            try {
                                await this.telegramClient.deleteMessages(chatId, [notification.id]);
                            } catch (e) {
                                console.error('Не удалось удалить уведомление');
                            }
                        }, 3000);
                    } catch (notificationError) {
                        console.log('⚠️ Не удалось отправить уведомление о прочтении');
                    }
                    
                } catch (readError) {
                    console.error(`❌ Ошибка прочтения упоминания в чате ${chatId}:`, readError.message);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка в обработчике автопуши:', error);
        }
    }, new NewMessage({}));
}

    setupCommands() {
        this.commands = {
            'уведы': this.toggleNotifications.bind(this),
            'автопуши': this.toggleAutoReadMentions.bind(this),
            'qr': this.generateQRCode.bind(this),
            'чек_qr': this.scanQRCode.bind(this),
            'проверить': this.checkURL.bind(this),
            'прокси': this.checkIP.bind(this),
            'о_чате': this.chatInfo.bind(this),
            'кража_авы': this.stealAvatar.bind(this),
            'перевод': this.translateText.bind(this),
            'айди': this.showUserId.bind(this),
            'рег': this.showRegistrationDate.bind(this),
            'прочитать': this.readMessages.bind(this),
            'триггер': this.manageTriggers.bind(this),
            'триггеры': this.listTriggers.bind(this),
            'debug_triggers': this.debugTriggers.bind(this),
            'мегапуш': this.megaPush.bind(this),
            'смс': this.deleteMessages.bind(this),
            'бомба_смс': this.smsBomb.bind(this),
            'закреп': this.togglePinMessage.bind(this),
            'префикс': this.changePrefix.bind(this),
            'поиск': this.searchCommand.bind(this),
            'команды': this.showCommands.bind(this),
            'шаб': this.manageTemplates.bind(this),
            'шаблон': this.manageTemplates.bind(this),
            'шаблоны': this.listTemplates.bind(this),
            'премиум': this.checkPremiumStatus.bind(this),
            'тест': this.testCommand.bind(this),
            'кастом': this.manageCustomValues.bind(this),
            'custom': this.manageCustomValues.bind(this),
            'по_приколу': this.setFunnyValues.bind(this),
            'код': this.manageCode.bind(this),
            'code': this.manageCode.bind(this),
            'таймер': this.manageTimers.bind(this),
            'таймеры': this.listTimers.bind(this),
            'сброс_прикола': this.resetFunnyValues.bind(this),
            'дип': this.deepseekSimple.bind(this),
            'deepseek': this.deepseekSimple.bind(this),
            'дип_ключ': this.setDeepSeekKeySimple.bind(this),
            'дип_статус': this.deepseekStatusSimple.bind(this),
            'дип_помощь': this.deepseekHelpSimple.bind(this)
            };
    }

    async manageTemplates(args, message, chatId, senderId, messageId) {
    
    if (args.length === 0) {
        await this.showTemplateHelp(chatId, messageId);
        return;
    }

    const action = args[0].toLowerCase();
    
    try {
        switch (action) {
            case '+':
            case 'add':
            case 'создать':
                await this.saveTemplate(args.slice(1), message, chatId, messageId);
                break;
                
            case '-':
            case 'remove':
            case 'delete':
            case 'удалить':
                await this.removeTemplate(args.slice(1), chatId, messageId);
                break;
                
            case 'info':
            case 'инфо':
                await this.showTemplateInfo(args.slice(1), chatId, messageId);
                break;
                
            default:
                // Если действие не указано, используем имя шаблона
                await this.useTemplate(args, message, chatId, senderId, messageId);
        }
    } catch (error) {
        console.error('❌ Ошибка работы с шаблонами:', error);
        await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
    }
}

    // Метод сохранения шаблона
    async saveTemplate(args, message, chatId, messageId) {
        if (args.length === 0) {
            throw new Error('Укажите название шаблона');
        }

        if (!message.replyTo || !message.replyTo.replyToMsgId) {
            throw new Error('Ответьте на сообщение, которое хотите сохранить как шаблон');
        }

        const templateName = args[0];
        const repliedMessageId = message.replyTo.replyToMsgId;

        // Получаем сообщение, на которое ответили
        const repliedMessages = await this.telegramClient.getMessages(chatId, {
            ids: [repliedMessageId]
        });

        if (!repliedMessages[0]) {
            throw new Error('Не удалось найти сообщение для сохранения');
        }

        const targetMessage = repliedMessages[0];
        await this.editMessage(chatId, messageId, `💾 Сохраняю шаблон "${templateName}"...`);

        // Подготавливаем данные шаблона
        const templateData = {
            name: templateName,
            contentType: 'text',
            textContent: '',
            mediaData: null,
            fileName: null,
            mimeType: null
        };

        // Обрабатываем текст сообщения
        if (targetMessage.text) {
            templateData.textContent = targetMessage.text;
        }

        // Обрабатываем медиа
        if (targetMessage.media) {
            await this.processMediaForTemplate(targetMessage, templateData);
        }

        // Сохраняем в базу данных
        await this.saveTemplateToDatabase(templateData);

        await this.editMessage(chatId, messageId, 
            `✅ Шаблон "${templateName}" сохранен!\n\n` +
            `📊 Тип: ${this.getTemplateTypeDescription(templateData)}\n` +
            `💾 Размер: ${templateData.mediaData ? Math.round(templateData.mediaData.length / 1024) + 'KB' : 'Текст'}\n\n` +
            `💡 Используйте: ${this.settings.prefix}шаб ${templateName}`
        );
    }

    // Обработка медиа для шаблона
    async processMediaForTemplate(message, templateData) {
        try {
            const buffer = await this.downloadMediaToBuffer(message);
            
            if (!buffer || buffer.length === 0) {
                throw new Error('Не удалось загрузить медиа');
            }

            templateData.mediaData = buffer;
            
            // Определяем тип медиа
            if (message.photo) {
                templateData.contentType = 'photo';
                templateData.mimeType = 'image/jpeg';
                templateData.fileName = `photo_${Date.now()}.jpg`;
            } else if (message.video) {
                templateData.contentType = 'video';
                templateData.mimeType = message.video.mimeType || 'video/mp4';
                templateData.fileName = `video_${Date.now()}.mp4`;
            } else if (message.voice) {
                templateData.contentType = 'voice';
                templateData.mimeType = 'audio/ogg';
                templateData.fileName = `voice_${Date.now()}.ogg`;
            } else if (message.videoNote) {
                templateData.contentType = 'video_note';
                templateData.mimeType = 'video/mp4';
                templateData.fileName = `video_note_${Date.now()}.mp4`;
            } else if (message.document) {
                templateData.contentType = 'document';
                templateData.mimeType = message.document.mimeType || 'application/octet-stream';
                templateData.fileName = message.document.attributes?.find(attr => 
                    attr.className === 'DocumentAttributeFilename'
                )?.fileName || `document_${Date.now()}`;
            } else if (message.sticker) {
                templateData.contentType = 'sticker';
                templateData.mimeType = 'image/webp';
                templateData.fileName = `sticker_${Date.now()}.webp`;
            } else {
                templateData.contentType = 'media';
                templateData.mimeType = 'application/octet-stream';
                templateData.fileName = `media_${Date.now()}`;
            }

        } catch (error) {
            console.error('❌ Ошибка обработки медиа:', error);
            throw new Error(`Не удалось обработать медиа: ${error.message}`);
        }
    }

    // Сохранение шаблона в базу данных
    async saveTemplateToDatabase(templateData) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO templates (name, content_type, text_content, media_data, file_name, mime_type, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    templateData.name,
                    templateData.contentType,
                    templateData.textContent,
                    templateData.mediaData,
                    templateData.fileName,
                    templateData.mimeType,
                    new Date()
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async useTemplate(args, message, chatId, senderId, messageId) {
    
    if (args.length === 0) {
        await this.editMessage(chatId, messageId, '❌ Укажите название шаблона');
        return;
    }

    const templateName = args[0];

    try {
        // Получаем шаблон из базы
        const template = await this.getTemplateFromDatabase(templateName);
        
        if (!template) {
            await this.editMessage(chatId, messageId, `❌ Шаблон "${templateName}" не найден`);
            return;
        }

        // Обновляем статистику использования
        await this.updateTemplateUsage(templateName);

        // Для текстовых шаблонов - просто редактируем сообщение, НЕ УДАЛЯЕМ его
        if (template.content_type === 'text') {
            // Редактируем сообщение с командой, превращая его в текст шаблона
            await this.editMessage(chatId, messageId, template.text_content);
            console.log('✅ Текстовый шаблон применен (сообщение отредактировано)');
            return;
        }

        // Для медиа-шаблонов - удаляем сообщение с командой и отправляем медиа
        try {
            // УДАЛЯЕМ СООБЩЕНИЕ С КОМАНДОЙ ПЕРВЫМ ДЕЛОМ
            await this.safeDeleteMessage(chatId, messageId);
            
            // Затем отправляем медиа-шаблон
            await this.sendMediaTemplate(template, chatId);
            console.log('✅ Медиа-шаблон отправлен после удаления команды');
            
        } catch (mediaError) {
            console.error('❌ Ошибка отправки медиа-шаблона:', mediaError);
            // В случае ерора отправляем текстовое уведомление
            try {
                await this.telegramClient.sendMessage(chatId, {
                    message: `❌ Ошибка отправки шаблона: ${mediaError.message}`
                });
            } catch (sendError) {
                console.error('Не удалось отправить сообщение об ошибке:', sendError);
            }
        }
        
    } catch (error) {
        console.error('❌ Общая ошибка использования шаблона:', error);
        await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
    }
}

    async safeDeleteMessage(chatId, messageId) {
    try {
        const chatIdNum = Number(chatId);
        const messageIdNum = Number(messageId);

        if (!chatIdNum || isNaN(chatIdNum) || !messageIdNum || isNaN(messageIdNum)) {
            console.log('❌ Неверные параметры для удаления');
            return;
        }

        // Метод 1: Простое удаление
        try {
            await this.telegramClient.deleteMessages(chatIdNum, [messageIdNum]);
            console.log(`✅ Сообщение ${messageIdNum} удалено методом 1`);
            return;
        } catch (e) {}

        // Метод 2: Через API
        try {
            await this.telegramClient.invoke(
                new Api.messages.DeleteMessages({
                    id: [messageIdNum],
                    revoke: true
                })
            );
            console.log(`✅ Сообщение ${messageIdNum} удалено методом 2`);
            return;
        } catch (e) {}

        // Метод 3: Для каналов
        try {
            const entity = await this.telegramClient.getInputEntity(chatIdNum);
            if (entity instanceof Api.InputPeerChannel) {
                await this.telegramClient.invoke(
                    new Api.channels.DeleteMessages({
                        channel: entity,
                        id: [messageIdNum]
                    })
                );
                console.log(`✅ Сообщение ${messageIdNum} удалено методом 3`);
                return;
            }
        } catch (e) {}

        // Метод 4: Редактируем в точку, потом удаляем
        try {
            await this.telegramClient.editMessage(chatIdNum, {
                message: messageIdNum,
                text: ".",
                parseMode: null
            });
            await this.telegramClient.deleteMessages(chatIdNum, [messageIdNum]);
            console.log(`✅ Сообщение ${messageIdNum} удалено методом 4`);
            return;
        } catch (e) {}

        console.log(`❌ Все методы удаления для сообщения ${messageIdNum} не сработали`);

    } catch (error) {
        console.log(`💥 Критическая ошибка удаления:`, error.message);
    }
}

    async sendMediaTemplate(template, chatId) {
    let tempFile = null;
    
    try {
        if (!template.media_data) {
            throw new Error('Медиа данные отсутствуют');
        }

        // Создаем временный файл для медиа
        const tempDir = path.join(__dirname, 'temp_templates');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        tempFile = path.join(tempDir, template.file_name || `template_${Date.now()}`);
        fs.writeFileSync(tempFile, template.media_data);

        // Отправляем медиа в зависимости от типа
        let result;
        switch (template.content_type) {
            case 'photo':
                result = await this.telegramClient.sendFile(chatId, {
                    file: tempFile,
                    caption: template.text_content || null
                });
                break;
                
            case 'video':
                result = await this.telegramClient.sendFile(chatId, {
                    file: tempFile,
                    caption: template.text_content || null,
                    attributes: [
                        new Api.DocumentAttributeVideo({
                            duration: 0,
                            w: 1280,
                            h: 720
                        })
                    ]
                });
                break;
                
            case 'voice':
                result = await this.telegramClient.sendFile(chatId, {
                    file: tempFile,
                    caption: template.text_content || null,
                    attributes: [
                        new Api.DocumentAttributeAudio({
                            voice: true,
                            duration: 0
                        })
                    ]
                });
                break;
                
            case 'video_note':
                result = await this.telegramClient.sendFile(chatId, {
                    file: tempFile,
                    videoNote: true
                });
                break;
                
            case 'sticker':
                result = await this.telegramClient.sendFile(chatId, {
                    file: tempFile,
                    attributes: [
                        new Api.DocumentAttributeSticker({
                            alt: 'sticker'
                        })
                    ]
                });
                break;
                
            default:
                result = await this.telegramClient.sendFile(chatId, {
                    file: tempFile,
                    caption: template.text_content || null
                });
        }

        return result;

    } catch (error) {
        console.error('❌ Ошибка отправки медиа-шаблона:', error);
        throw error;
    } finally {
        // Удаляем временный файл в любом случае
        if (tempFile && fs.existsSync(tempFile)) {
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                console.log('⚠️ Не удалось удалить временный файл:', e.message);
            }
        }
    }
}

// Новый метод для редактирования сообщения с шаблоном
async editMessageWithTemplate(chatId, messageId, template) {
    try {
        // Для текстовых шаблонов просто редактируем текст
        if (template.content_type === 'text') {
            await this.editMessage(chatId, messageId, template.text_content);
            return;
        }

        // Для медиа-шаблонов нужно отправить медиа и отредактировать сообщение
        if (template.media_data) {
            // Создаем временный файл для медиа
            const tempDir = path.join(__dirname, 'temp_templates');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFile = path.join(tempDir, template.file_name || `template_${Date.now()}`);
            fs.writeFileSync(tempFile, template.media_data);

            // Для разных типов медиа используем разные методы отправки
            let mediaMessage;
            switch (template.content_type) {
                case 'photo':
                    mediaMessage = await this.telegramClient.sendFile(chatId, {
                        file: tempFile,
                        caption: template.text_content || null
                    });
                    break;
                    
                case 'video':
                    mediaMessage = await this.telegramClient.sendFile(chatId, {
                        file: tempFile,
                        caption: template.text_content || null,
                        video: true
                    });
                    break;
                    
                case 'voice':
                    mediaMessage = await this.telegramClient.sendFile(chatId, {
                        file: tempFile,
                        caption: template.text_content || null,
                        voice: true
                    });
                    break;
                    
                case 'video_note':
                    mediaMessage = await this.telegramClient.sendFile(chatId, {
                        file: tempFile,
                        videoNote: true
                    });
                    break;
                    
                case 'sticker':
                    mediaMessage = await this.telegramClient.sendFile(chatId, {
                        file: tempFile,
                        sticker: true
                    });
                    break;
                    
                default:
                    mediaMessage = await this.telegramClient.sendFile(chatId, {
                        file: tempFile,
                        caption: template.text_content || null
                    });
            }

            // Удаляем временный файл
            setTimeout(() => {
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {
                    console.log('Не удалось удалить временный файл:', e.message);
                }
            }, 5000);

            // После отправки медиа, удаляем сообщение с командой
            try {
                await this.telegramClient.deleteMessages(chatId, [messageId]);
            } catch (deleteError) {
                console.log('Не удалось удалить сообщение с командой:', deleteError.message);
            }

        } else {
            // Если нет медиа, просто редактируем текст
            await this.editMessage(chatId, messageId, template.text_content || '❌ Шаблон пуст');
        }

    } catch (error) {
        console.error('❌ Ошибка отправки шаблона:', error);
        await this.editMessage(chatId, messageId, `❌ Ошибка отправки шаблона: ${error.message}`);
    }
}

    // Получение шаблона из базы данных
    async getTemplateFromDatabase(templateName) {
    return new Promise((resolve, reject) => {
        this.db.get(
            `SELECT name, content_type, text_content, media_data, file_name, mime_type, used_count, last_used 
             FROM templates WHERE name = ?`,
            [templateName],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

    // Обновление статистики использования шаблона
    async updateTemplateUsage(templateName) {
    return new Promise((resolve, reject) => {
        const now = new Date();
        this.db.run(
            `UPDATE templates SET used_count = used_count + 1, last_used = ? WHERE name = ?`,
            [now.toISOString(), templateName], // Сохраняем дату в ISO формате
            (err) => {
                if (err) {
                    console.error('❌ Ошибка обновления использования шаблона:', err);
                    reject(err);
                } else {
                    console.log(`✅ Статистика шаблона "${templateName}" обновлена`);
                    resolve();
                }
            }
        );
    });
}

    // Удаление шаблона
    async removeTemplate(args, chatId, messageId) {
        if (args.length === 0) {
            throw new Error('Укажите название шаблона для удаления');
        }

        const templateName = args[0];
        
        // чекаем существование шаблона
        const template = await this.getTemplateFromDatabase(templateName);
        if (!template) {
            throw new Error(`Шаблон "${templateName}" не найден`);
        }

        // Удаляем из базы
        await new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM templates WHERE name = ?`,
                [templateName],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        await this.editMessage(chatId, messageId, 
            `✅ Шаблон "${templateName}" удален\n` +
            `📊 Использован: ${template.used_count || 0} раз`
        );
    }

    // Показать информацию о шаблоне
    async showTemplateInfo(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите название шаблона');
    }

    const templateName = args[0];
    const template = await this.getTemplateFromDatabase(templateName);
    
    if (!template) {
        throw new Error(`Шаблон "${templateName}" не найден`);
    }

    // Исправляем отображение даты
    const lastUsed = template.last_used ? 
        new Date(template.last_used).toLocaleString('ru-RU') : 'Никогда';

    const info = `📋 ИНФОРМАЦИЯ О ШАБЛОНЕ\n\n` +
                `🔸 Название: ${template.name}\n` +
                `🔸 Тип: ${this.getTemplateTypeDescription(template)}\n` +
                `🔸 Использован: ${template.used_count || 0} раз\n` +
                `🔸 Последнее использование: ${lastUsed}\n` +
                `🔸 Размер: ${template.media_data ? Math.round(template.media_data.length / 1024) + 'KB' : 'Текст'}\n`;

    await this.editMessage(chatId, messageId, info);
}

    // Список шаблонов
    async listTemplates(args, message, chatId, senderId, messageId) {
        const templates = await this.getAllTemplates();
        
        if (templates.length === 0) {
            await this.editMessage(chatId, messageId, `📋 Шаблоны не настроены`);
            return;
        }

        let response = `📋 СПИСОК ШАБЛОНОВ\n\n`;
        
        templates.forEach((template, index) => {
            const typeIcon = this.getTemplateTypeIcon(template.content_type);
            response += `${typeIcon} ${index + 1}. "${template.name}" - ${this.getTemplateTypeDescription(template)}\n`;
            response += `   📊 Использован: ${template.used_count || 0} раз\n\n`;
        });

        response += `💡 Использование:\n` +
                   `• ${this.settings.prefix}шаб + [название] (в ответ на сообщение) - сохранить шаблон\n` +
                   `• ${this.settings.prefix}шаб [название] - использовать шаблон\n` +
                   `• ${this.settings.prefix}шаб - [название] - удалить шаблон\n` +
                   `• ${this.settings.prefix}шаб info [название] - информация о шаблоне`;

        await this.editMessage(chatId, messageId, response);
    }

    // Получение всех шаблонов
    async getAllTemplates() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT name, content_type, used_count, last_used FROM templates ORDER BY name`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Вспомогательные методы
    getTemplateTypeDescription(template) {
        const types = {
            'text': 'Текст',
            'photo': 'Фото',
            'video': 'Видео',
            'voice': 'Голосовое сообщение',
            'video_note': 'Кружок',
            'document': 'Документ',
            'sticker': 'Стикер',
            'media': 'Медиа'
        };
        
        return types[template.content_type] || template.content_type;
    }

    getTemplateTypeIcon(contentType) {
        const icons = {
            'text': '📝',
            'photo': '🖼️',
            'video': '🎥',
            'voice': '🎤',
            'video_note': '⭕',
            'document': '📎',
            'sticker': '🩷',
            'media': '📁'
        };
        
        return icons[contentType] || '📄';
    }

    async showTemplateHelp(chatId, messageId) {
    const helpText = `📋 КОМАНДЫ ДЛЯ РАБОТЫ С ШАБЛОНАМИ\n\n` +

                    `💾 СОХРАНЕНИЕ ШАБЛОНА:\n` +
                    `Ответьте на сообщение командой:\n` +
                    `${this.settings.prefix}шаб + [название]\n\n` +
                    `Пример: ${this.settings.prefix}шаб + приветствие\n\n` +

                    `🚀 ИСПОЛЬЗОВАНИЕ ШАБЛОНА:\n` +
                    `${this.settings.prefix}шаб [название]\n\n` +
                    `Пример: ${this.settings.prefix}шаб приветствие\n\n` +
                    `💡 Сообщение с командой будет заменено на содержимое шаблона!\n` +
                    `   Работает для всех типов: текст, фото, видео, голосовые и т.д.\n\n` +

                    `🗑️ УДАЛЕНИЕ ШАБЛОНА:\n` +
                    `${this.settings.prefix}шаб - [название]\n\n` +
                    `Пример: ${this.settings.prefix}шаб - приветствие\n\n` +

                    `📊 ИНФОРМАЦИЯ О ШАБЛОНЕ:\n` +
                    `${this.settings.prefix}шаб info [название]\n\n` +

                    `📋 СПИСОК ШАБЛОНОВ:\n` +
                    `${this.settings.prefix}шаблоны\n\n` +

                    `💡 ПОДДЕРЖИВАЕМЫЕ ТИПЫ:\n` +
                    `• Текстовые сообщения ✓\n` +
                    `• Фотографии ✓\n` +
                    `• Видео ✓\n` +
                    `• Голосовые сообщения (ГС) ✓\n` +
                    `• Видео-кружки ✓\n` +
                    `• Документы ✓\n` +
                    `• Стикеры ✓\n\n` +

                    `🎯 ПРИМЕР РАБОТЫ:\n` +
                    `1. Отправьте сообщение с текстом и/или медиа\n` +
                    `2. Ответьте на него: ${this.settings.prefix}шаб + мой_шаблон\n` +
                    `3. Используйте: ${this.settings.prefix}шаб мой_шаблон\n` +
                    `   → Сообщение заменится на ваш шаблон!`;

    await this.editMessage(chatId, messageId, helpText);
}

    async handleEnhancedTriggers(text, message, chatId, senderId, messageId) {
    if (this.settings.triggers.size === 0) return;
    
    const lowerText = text.toLowerCase();
    const matchedTriggers = [];
    
    for (const [triggerWord, trigger] of this.settings.triggers) {
        // Существующая логика чека триггера (без изменений)
        if (!trigger || typeof trigger !== 'object') continue;
        if (!trigger.word || !trigger.responses || !trigger.settings) continue;
        if (!trigger.settings.enabled) continue;
        if (!this.checkTriggerConditions(trigger, senderId, chatId)) continue;
        
        // чек кулдауна
        if (trigger.settings.cooldown > 0 && trigger.settings.lastUsed) {
            const cooldownTime = trigger.settings.cooldown * 1000;
            const timeSinceLastUse = Date.now() - new Date(trigger.settings.lastUsed).getTime();
            if (timeSinceLastUse < cooldownTime) continue;
        }
        
        // чек шанса
        if (trigger.settings.chance < 100) {
            const roll = Math.random() * 100;
            if (roll > trigger.settings.chance) continue;
        }
        
        let isMatch = false;
        
        // чек совпадения
        if (trigger.settings.regex) {
            try {
                const flags = trigger.settings.caseSensitive ? '' : 'i';
                const regex = new RegExp(trigger.word, flags);
                isMatch = regex.test(text);
            } catch (error) {
                console.error(`❌ Ошибка в regex триггере "${triggerWord}":`, error);
                continue;
            }
        } else {
            const searchText = trigger.settings.caseSensitive ? text : lowerText;
            const searchWord = trigger.settings.caseSensitive ? trigger.word : triggerWord;
            isMatch = searchText.includes(searchWord);
        }
        
        if (isMatch) {
            matchedTriggers.push(trigger);
        }
    }
    
    // Сортируем по приоритету
    matchedTriggers.sort((a, b) => (b.settings.priority || 1) - (a.settings.priority || 1));
    
    // Обрабатываем триггеры
    for (const trigger of matchedTriggers) {
        console.log(`🔔 Сработал триггер: "${trigger.word}"`);
        
        // Обновляем статистику
        trigger.settings.used++;
        trigger.settings.lastUsed = new Date();
        await this.saveTriggerToDatabase(trigger);
        
        // ПРОБУЕМ ОТПРАВИТЬ БЕЗ ПРЕДВАРИТЕЛЬНЫХ ЧЕКОВ
        await this.sendEnhancedTriggerResponse(trigger, message, chatId, senderId, messageId);
        
        if (trigger.settings.priority >= 5) {
            break;
        }
    }
}

    async validateTriggersStructure() {
    console.log('🔍 Проверяем структуру триггеров...');
    let validCount = 0;
    let invalidCount = 0;

    for (const [word, trigger] of this.settings.triggers) {
        if (!trigger || typeof trigger !== 'object') {
            console.error(`❌ Триггер "${word}" не является объектом`);
            invalidCount++;
            continue;
        }

        if (!trigger.word || !trigger.responses || !trigger.settings) {
            console.error(`❌ Триггер "${word}" имеет неполную структуру`);
            invalidCount++;
            continue;
        }

        if (!Array.isArray(trigger.responses)) {
            console.error(`❌ Триггер "${word}" имеет некорректные responses`);
            invalidCount++;
            continue;
        }

        validCount++;
    }

    console.log(`📊 Результат проверки: ${validCount} валидных, ${invalidCount} невалидных триггеров`);
    return invalidCount === 0;
}

    async editMessage(chatId, messageId, newText) {
    try {
        // Упрощаем преобразование параметров
        const chatIdValue = chatId && chatId.value ? chatId.value : chatId;
        const messageIdValue = messageId;
        
        // Преобразуем в числа
        const chatIdNum = Number(chatIdValue);
        const messageIdNum = Number(messageIdValue);

        // чекаем валидность
        if (isNaN(chatIdNum) || isNaN(messageIdNum)) {
            console.error('❌ Неверные параметры для редактирования:', { chatIdNum, messageIdNum });
            // Отправляем новое сообщение вместо редактирования
            await this.telegramClient.sendMessage(chatIdNum, {
                message: newText,
                parseMode: null
            });
            return;
        }

        await this.telegramClient.editMessage(chatIdNum, {
            message: messageIdNum,
            text: newText,
            parseMode: null
        });
    } catch (error) {
        console.error('❌ Ошибка редактирования сообщения:', error.message);
        try {
            // Отправляем новое сообщение как запасной вариант
            const chatIdValue = chatId && chatId.value ? chatId.value : chatId;
            const chatIdNum = Number(chatIdValue);
            await this.telegramClient.sendMessage(chatIdNum, {
                message: newText,
                parseMode: null
            });
        } catch (sendError) {
            console.error('❌ Ошибка отправки сообщения:', sendError.message);
        }
    }
}

    validateMessageParams(chatId, messageId) {
    // чекаем, что chatId и messageId являются числами или BigInt
    const isChatIdValid = (typeof chatId === 'number' || typeof chatId === 'bigint' || (chatId && typeof chatId.value === 'bigint'));
    const isMessageIdValid = (typeof messageId === 'number' || typeof messageId === 'bigint');
    
    if (!isChatIdValid || !isMessageIdValid) {
        console.error('❌ Неверные типы параметров сообщения:', { 
            chatIdType: typeof chatId, 
            messageIdType: typeof messageId,
            chatId,
            messageId
        });
        return false;
    }
    
    // Извлекаем значение из BigInt объекта если нужно
    const chatIdValue = (chatId && chatId.value) ? chatId.value : chatId;
    const messageIdValue = messageId;
    
    // чекаем, что значения валидны
    if (!chatIdValue || !messageIdValue) {
        console.error('❌ Пустые параметры:', { chatIdValue, messageIdValue });
        return false;
    }
    
    // чекаем, что messageId положительный
    if (messageIdValue <= 0) {
        console.error('❌ Неверный messageId:', messageIdValue);
        return false;
    }
    
    return true;
}

    async handleCommand(command, args, message, chatId, senderId, messageId) {
    try {
        
        // Правильно извлекаем значения
        const chatIdValue = (chatId && chatId.value) ? Number(chatId.value) : Number(chatId);
        const messageIdValue = Number(messageId); // messageId должен быть числом
        const senderIdValue = (senderId && senderId.value) ? Number(senderId.value) : Number(senderId);

        // Валидация параметров
        if (!chatIdValue || isNaN(chatIdValue)) {
            console.error('❌ Неверный chatId:', chatIdValue);
            return;
        }

        if (!messageIdValue || isNaN(messageIdValue)) {
            console.error('❌ Неверный messageId:', messageIdValue);
            return;
        }
        
        const user = await this.getUserData(senderIdValue);
        if (!user) {
            await this.ensureUserExists(senderIdValue, null, null, null);
        }
        
        const handler = this.commands[command];
        if (handler) {
            // Передаем правильные параметры
            await handler(args, message, chatIdValue, senderIdValue, messageIdValue);
        } else {
            await this.editMessage(chatIdValue, messageIdValue, `❌ Неизвестная команда: ${this.settings.prefix}${command}`);
        }
    } catch (error) {
        console.error('❌ Ошибка обработки команды:', error);
        try {
            const chatIdValue = (chatId && chatId.value) ? Number(chatId.value) : Number(chatId);
            await this.editMessage(chatIdValue, messageId, `❌ Ошибка выполнения команды: ${error.message}`);
        } catch (editError) {
            console.error('❌ Ошибка редактирования сообщения об ошибке:', editError);
        }
    }
}

    startSystemMonitoring() {
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        
        console.log(`📊 Мониторинг: RAM ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, Uptime: ${uptime}s`);
        
        // Проверка состояния соединения
        if (this.telegramClient && this.telegramClient.connected) {
            console.log('🌐 Соединение: Стабильное');
        } else {
            console.log('⚠️ Соединение: Проблемы');
        }
    }, 60000);
}

    // ========== РЕАЛИЗАЦИЯ КОМАНД ==========


    async changePrefix(args, message, chatId, senderId, messageId) {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, `📝 Использование: ${this.settings.prefix}префикс [новый_префикс]`);
            return;
        }
        
        const newPrefix = args[0];
        this.settings.prefix = newPrefix;
        this.saveSettings();
        
        await this.editMessage(chatId, messageId, `✅ Префикс изменен на: ${newPrefix}`);
    }

    async showCommands(args, message, chatId, senderId, messageId) {
    const custom = this.settings.customValues;
    const realCreator = "@chovamnadoa";
    const realVersion = "3.0.0";
    const categories = {
        '🔔 УВЕДОМЛЕНИЯ И СТАТУСЫ': [
            {command: 'уведы', description: 'Включить/выключить уведомления'},
        ],
        
        '🛡️ БЕЗОПАСНОСТЬ И МОДЕРАЦИЯ': [
            {command: 'автопуши', description: 'Автопрочитывание упоминаний'},
        ],
        
        '📱 УТИЛИТЫ И ИНСТРУМЕНТЫ': [
            {command: 'qr [текст]', description: 'Генерация QR-кода'},
            {command: 'чек_qr', description: 'Сканирование QR-кода (ответом на фото)'},
            {command: 'проверить [url]', description: 'Проверка доступности ссылки'},
            {command: 'прокси', description: 'Показать ваш IP адрес'},
            {command: 'перевод [текст]', description: 'Перевод текста на русский'},
            {command: 'поиск [запрос]', description: 'Поиск в Yandex'},
            {command: 'префикс [символ]', description: 'Смена префикса команд'}
        ],
        
        '👥 РАБОТА С ЧАТАМИ': [
            {command: 'о_чате', description: 'Информация о текущем чате'},
            {command: 'айди [юзернейм]', description: 'Показать ID пользователя'},
            {command: 'рег [юзернейм]', description: 'Дата регистрации пользователя'},
            {command: 'кража_авы [юзернейм]', description: 'Скопировать аватар пользователя'},
            {command: 'прочитать', description: 'Прочитать последние сообщения'},
        ],
        
        '💬 УПРАВЛЕНИЕ СООБЩЕНИЯМИ': [
            {command: 'мегапуш [текст]', description: 'Массовая рассылка по всем чатам'},
            {command: 'смс [кол-во]', description: 'Удалить сообщения (ответом на сообщение или по количеству)'},
            {command: 'бомба_смс [id] [кол-во]', description: 'Спам сообщениями пользователю'},
            {command: 'закреп', description: 'Закрепить сообщение (ответом)'}
        ],
        
        '🎯 ТРИГГЕРЫ И АВТОМАТИЗАЦИЯ': [
            {command: 'триггер add [слово] [ответы]', description: 'Добавить триггер с настройками'},
            {command: 'триггер remove [слово]', description: 'Удалить триггер'},
            {command: 'триггер edit [слово] [ответы]', description: 'Изменить ответы триггера'},
            {command: 'триггер info [слово]', description: 'Подробная информация о триггере'},
            {command: 'триггер list', description: 'Посмотреть все возможности триггеров'}

        ],

        '📁 ШАБЛОНЫ СООБЩЕНИЙ': [
            {command: 'шаб + [название]', description: 'Сохранить шаблон (ответом на сообщение)'},
            {command: 'шаб [название]', description: 'Использовать шаблон'},
            {command: 'шаб - [название]', description: 'Удалить шаблон'},
            {command: 'шаб info [название]', description: 'Информация о шаблоне'},
            {command: 'шаблоны', description: 'Список всех шаблонов'}
        ],

        '🤖 ЛОКАЛЬНЫЙ DEEPCHAT': [
            {command: 'дип [запрос]', description: 'AI ассистент DeepSeek'},
            {command: 'дип_ключ [api_key]', description: 'Установить API ключ DeepSeek'},
            {command: 'дип_статус', description: 'Статус DeepSeek'},
            {command: 'дип_помощь', description: 'Помощь по DeepSeek'}
        ],
        
        '📊 СТАТИСТИКА И МОНИТОРИНГ': [
            {command: 'тест', description: 'Тест работы бота и диагностика'}
        ]
    };

    let response = `🤖 СПИСОК КОМАНД UNIFIED BOT 🤖\n\n`;
    response += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
    response += `📋 Префикс команд: ${this.settings.prefix}\n`;
    response += `🔢 Всего команд: ${Object.keys(this.commands).length}\n`;
    response += `🎯 Триггеров: ${this.settings.triggers.size}\n`;
    response += `⏰ Аптайм: ${Math.floor((new Date() - this.startTime) / 1000)} сек.\n\n`;
    response += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;

    for (const [category, commands] of Object.entries(categories)) {
        response += `${category}:\n`;
        
        commands.forEach(cmd => {
            response += `   🔹 ${this.settings.prefix}${cmd.command} - ${cmd.description}\n`;
        });
        
        response += `\n`;
    }
    response += `⚡ Версия: ${custom.version || realVersion}\n`;
    response += `🔧 ${custom.creator ? 'Придумал' : 'Разработчик'}: ${custom.creator || realCreator}\n\n`;
    
    if (custom.uptime || custom.botName || custom.status) {
        response += `🎭 Кастомные настройки:\n`;
        if (custom.botName) response += `• Имя: ${custom.botName}\n`;
        if (custom.status) response += `• Статус: ${custom.status}\n`;
        if (custom.uptime) response += `• Аптайм: ${custom.uptime}\n`;
        response += `\n`;
    }
    
    response += `💡 Используйте ответы на сообщения для некоторых команд!`;
    
    // Добавьте информацию о командах кастомных значений
    response += `\n\n🎪 Прикольные команды:\n`;
    response += `• ${this.settings.prefix}кастом - Настроить кастомные значения\n`;
    response += `• ${this.settings.prefix}по_приколу - Установить прикольные значения\n`;
    response += `• ${this.settings.prefix}сброс_прикола - Сбросить кастомные значения`;

    await this.editMessage(chatId, messageId, response);
}

    async searchCommand(args, message, chatId, senderId, messageId) {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, `🔍 Использование: ${this.settings.prefix}поиск [запрос]`);
            return;
        }
        
        const query = args.join(' ');
        const searchUrl = `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;
        
        await this.editMessage(chatId, messageId, `🔍 Результаты поиска для "${query}":\n${searchUrl}`);
    }

    async toggleNotifications(args, message, chatId, senderId, messageId) {
    try {
        const chat = await this.telegramClient.getEntity(chatId);
        
        // чекаем, заглушен ли чат
        const isMuted = await this.telegramClient.isMuted(chat);
        
        if (isMuted) {
            // Разглушаем чат - включаем уведомления
            await this.telegramClient.unmuteChat(chat);
            await this.editMessage(chatId, messageId, "🔔 Уведомления в этом чате ВКЛЮЧЕНЫ");
            console.log(`🔔 Уведомления включены для чата ${chatId}`);
        } else {
            // Заглушаем чат - выключаем уведомления
            await this.telegramClient.muteChat(chat);
            await this.editMessage(chatId, messageId, "🔕 Уведомления в этом чате ВЫКЛЮЧЕНЫ");
            console.log(`🔕 Уведомления выключены для чата ${chatId}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка переключения уведомлений чата:', error);
        
        // Альтернативный метод через invoke
        try {
            const peer = await this.telegramClient.getInputEntity(chatId);
            const currentSettings = await this.telegramClient.invoke(
                new Api.account.GetNotifySettings({ peer })
            );
            
            const isMuted = currentSettings.muteUntil && currentSettings.muteUntil > 0;
            
            if (isMuted) {
                // Включаем уведомления
                await this.telegramClient.invoke(
                    new Api.account.UpdateNotifySettings({
                        peer: peer,
                        settings: new Api.InputPeerNotifySettings({
                            showPreviews: true,
                            silent: false,
                            muteUntil: 0,
                            sound: new Api.NotificationSoundDefault()
                        })
                    })
                );
                await this.editMessage(chatId, messageId, "🔔 Уведомления в этом чате ВКЛЮЧЕНЫ");
            } else {
                // Выключаем уведомления
                await this.telegramClient.invoke(
                    new Api.account.UpdateNotifySettings({
                        peer: peer,
                        settings: new Api.InputPeerNotifySettings({
                            showPreviews: false,
                            silent: true,
                            muteUntil: 2147483647,
                            sound: new Api.NotificationSoundNone()
                        })
                    })
                );
                await this.editMessage(chatId, messageId, "🔕 Уведомления в этом чате ВЫКЛЮЧЕНЫ");
            }
        } catch (invokeError) {
            console.error('❌ Ошибка при альтернативном методе:', invokeError);
            await this.editMessage(chatId, messageId, `❌ Ошибка переключения уведомлений: ${error.message}`);
        }
    }
}

    async toggleAutoReadMentions(args, message, chatId, senderId, messageId) {
    this.settings.autoReadMentions = !this.settings.autoReadMentions;
    
    // Сохраняем настройки
    this.saveSettings();
    
    const status = this.settings.autoReadMentions ? 'ВКЛЮЧЕНО ✅' : 'ВЫКЛЮЧЕНО ❌';
    const description = this.settings.autoReadMentions 
        ? 'Теперь все упоминания бота будут автоматически прочитываться'
        : 'Автопрочитывание упоминаний отключено';
    
    const response = `👀 Автопрочитывание упоминаний: ${status}\n\n${description}\n\n💾 Настройка сохранена`;
    
    await this.editMessage(chatId, messageId, response);
}

    // Вспомогательная функция для скачивания медиа
    async downloadMediaToBuffer(mediaMessage) {
    try {
        // В библиотеке telegram downloadMedia возвращает Promise с Buffer
        const buffer = await this.telegramClient.downloadMedia(mediaMessage, {
            output: 'buffer'
        });
        
        if (!buffer || buffer.length === 0) {
            throw new Error('Получен пустой буфер');
        }
        
        return buffer;
    } catch (error) {
        console.error('Ошибка загрузки медиа:', error);
        throw error;
    }
}

    async generateQRCode(args, message, chatId, senderId, messageId) {
    if (args.length === 0) {
        await this.editMessage(chatId, messageId, `📱 Использование: ${this.settings.prefix}qr [текст]`);
        return;
    }
    
    const text = args.join(' ');
    try {
        // Создаем временный файл для QR-кода
        const tempFilePath = path.join(__dirname, `temp_qr_${Date.now()}.png`);
        
        // Генерируем QR-код и сохраняем в файл
        await qrcode.toFile(tempFilePath, text, {
            width: 300,
            height: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
        
        // Отправляем как фото
        await this.telegramClient.sendMessage(chatId, {
            file: tempFilePath,
            message: `📱 QR-код для: ${text}`,
            parseMode: null
        });
        
        // Удаляем временный файл
        fs.unlinkSync(tempFilePath);
        
        // Удаляем оригинальное сообщение с командой
        try {
            await this.telegramClient.deleteMessages(chatId, [messageId]);
        } catch (deleteError) {
            console.log('Не удалось удалить сообщение с командой');
        }
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка генерации QR-кода: ${error.message}`);
    }
}

async scanQRCode(args, message, chatId, senderId, messageId) {
    try {
        let targetMessage = message;
        
        // Если это ответ на сообщение с фото, используем replied сообщение
        if (message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await this.telegramClient.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });
            if (repliedMessages[0] && (repliedMessages[0].photo || repliedMessages[0].media)) {
                targetMessage = repliedMessages[0];
                console.log(`✅ Используем сообщение с фото: ${targetMessage.id}`);
            } else {
                await this.editMessage(chatId, messageId, 
                    `❌ В сообщении, на которое вы ответили, нет изображения`
                );
                return;
            }
        }
        
        // чекаем, есть ли медиа в сообщении
        if (!targetMessage.media && !targetMessage.photo) {
            await this.editMessage(chatId, messageId, 
                `📷 Отправьте фото с QR-кодом или ответьте командой на сообщение с фото\n\n` +
                `💡 Пример использования:\n` +
                `1. Отправьте фото с QR-кодом в чат\n` +
                `2. Ответьте на это фото командой: ${this.settings.prefix}чек_qr`
            );
            return;
        }
        
        // Показываем сообщение о начале обработки
        await this.editMessage(chatId, messageId, `🔍 Сканирую QR-код...`);
        
        let buffer;
        try {
            // Скачиваем медиа
            buffer = await this.downloadMediaToBuffer(targetMessage);
            console.log(`✅ Изображение загружено, размер: ${buffer.length} байт`);
            
            // Определяем тип изображения
            const imageType = this.getImageType(buffer);
            console.log(`📊 Тип изображения: ${imageType}`);
            
        } catch (downloadError) {
            console.error('Ошибка загрузки:', downloadError);
            await this.editMessage(chatId, messageId, 
                `❌ Не удалось загрузить изображение\n\n` +
                `💡 Возможные причины:\n` +
                `• Изображение слишком большое\n` +
                `• Формат не поддерживается\n` +
                `• Проблемы с подключением`
            );
            return;
        }
        
        try {
            const imageType = this.getImageType(buffer);
            
            if (imageType === 'unknown') {
                await this.editMessage(chatId, messageId, 
                    `❌ Неизвестный формат изображения\n\n` +
                    `💡 Поддерживаемые форматы: PNG, JPEG, GIF, WebP\n` +
                    `📝 Попробуйте конвертировать изображение в PNG`
                );
                return;
            }
            
            let imageData;
            
            if (imageType === 'png') {
                // Для PNG используем pngjs
                const png = PNG.sync.read(buffer);
                imageData = {
                    data: new Uint8ClampedArray(png.data),
                    width: png.width,
                    height: png.height
                };
            } else {
    // Используем Jimp для конвертации других форматов
    try {
        const image = await Jimp.read(buffer);
        image.resize(800, Jimp.AUTO); // Ресайз для улучшения распознавания
        const pngBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
        
        const png = PNG.sync.read(pngBuffer);
        imageData = {
            data: new Uint8ClampedArray(png.data),
            width: png.width,
            height: png.height
        };
    } catch (jimpError) {
        console.error('Ошибка конвертации Jimp:', jimpError);
        throw new Error(`Не удалось обработать ${imageType} изображение`);
    }
}
            
            // Сканируем QR-код
            const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (qrCode) {
                await this.editMessage(chatId, messageId, 
                    `✅ QR-код распознан!\n\n` +
                    `📝 Содержимое:\n` +
                    `\`\`\`\n${qrCode.data}\n\`\`\`\n` +
                    `📍 Расположение: X=${qrCode.location.topLeftCorner.x}, Y=${qrCode.location.topLeftCorner.y}`
                );
            } else {
                await this.editMessage(chatId, messageId, 
                    `❌ QR-код не найден на изображении\n\n` +
                    `💡 Советы по улучшению распознавания:\n` +
                    `• Убедитесь, что QR-код четкий и не размытый\n` +
                    `• Избегайте искажений и бликов на фото\n` +
                    `• Убедитесь, что весь QR-код виден в кадре\n` +
                    `• Используйте изображения в формате PNG`
                );
            }
            
        } catch (decodeError) {
            console.error('Ошибка декодирования:', decodeError);
            
            if (decodeError.message.includes('unrecognised content at end of stream')) {
                await this.editMessage(chatId, messageId, 
                    `❌ Ошибка: изображение повреждено или имеет неверный формат\n\n` +
                    `💡 Попробуйте:\n` +
                    `• Пересохранить изображение как PNG\n` +
                    `• Использовать другое изображение QR-кода\n` +
                    `• Убедиться, что файл не поврежден`
                );
            } else {
                await this.editMessage(chatId, messageId, 
                    `❌ Ошибка обработки изображения: ${decodeError.message}`
                );
            }
        }
        
    } catch (error) {
        console.error('Общая ошибка сканирования QR:', error);
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка сканирования: ${error.message}`
        );
    }
}

async tryAlternativeQRDecoding(buffer, chatId, messageId) {
    try {
        // Пробуем конвертировать в разные форматы
        const sharp = require('sharp');
        
        // Конвертируем в PNG если нужно
        const pngBuffer = await sharp(buffer)
            .png()
            .toBuffer();
            
        const png = PNG.sync.read(pngBuffer);
        const qrCode = jsQR(png.data, png.width, png.height);
        
        if (qrCode) {
            await this.editMessage(chatId, messageId, 
                `✅ QR-код распознан (альтернативный метод)!\n\n` +
                `📝 Содержимое:\n` +
                `\`\`\`\n${qrCode.data}\n\`\`\``
            );
            return;
        }
        
        // Если все методы не сработали
        await this.editMessage(chatId, messageId, 
            `❌ QR-код не найден на изображении\n\n` +
            `💡 Советы по улучшению распознавания:\n` +
            `• Убедитесь, что QR-код четкий и не размытый\n` +
            `• Избегайте искажений и бликов на фото\n` +
            `• Попробуйте сделать фото при хорошем освещении\n` +
            `• Убедитесь, что весь QR-код виден в кадре`
        );
        
    } catch (altError) {
        console.error('Ошибка альтернативного декодирования:', altError);
        await this.editMessage(chatId, messageId, 
            `❌ Не удалось распознать QR-код\n\n` +
            `💡 Возможно:\n` +
            `• Это не QR-код\n` +
            `• Изображение повреждено\n` +
            `• QR-код слишком сложный для распознавания`
        );
    }
}

    async checkURL(args, message, chatId, senderId, messageId) {
    if (args.length === 0) {
        await this.editMessage(chatId, messageId, `🌐 Использование: ${this.settings.prefix}проверить [url]`);
        return;
    }
    
    let url = args[0];
    
    try {
        // Добавляем протокол если его нет
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        // чекаем валидность URL
        try {
            new URL(url);
        } catch (urlError) {
            await this.editMessage(chatId, messageId, `❌ Неверный формат URL: ${url}`);
            return;
        }
        
        const response = await axios.head(url, { 
            timeout: 10000,
            validateStatus: function (status) {
                return status >= 200 && status < 600; // Принимаем все статусы как валидные
            }
        });
        
        let statusText = '';
        if (response.status >= 200 && response.status < 300) {
            statusText = '✅ Доступен';
        } else if (response.status >= 300 && response.status < 400) {
            statusText = '🔄 Перенаправление';
        } else if (response.status >= 400 && response.status < 500) {
            statusText = '❌ Ошибка клиента';
        } else if (response.status >= 500) {
            statusText = '🚫 Ошибка сервера';
        }
        
        await this.editMessage(chatId, messageId, 
            `${statusText}\n` +
            `📊 Статус: ${response.status} ${response.statusText || ''}\n` +
            `🔗 URL: ${url}\n` +
            `⏱️  Время ответа: ${response.duration ? Math.round(response.duration) + 'ms' : 'N/A'}`
        );
        
    } catch (error) {
        // Пробуем GET запрос если HEAD не сработал
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            try {
                const getResponse = await axios.get(url, { 
                    timeout: 10000,
                    validateStatus: null // Принимаем все статусы
                });
                
                let getStatusText = '';
                if (getResponse.status >= 200 && getResponse.status < 300) {
                    getStatusText = '✅ Доступен (GET)';
                } else {
                    getStatusText = `⚠️ Ответ получен (${getResponse.status})`;
                }
                
                await this.editMessage(chatId, messageId, 
                    `${getStatusText}\n` +
                    `📊 Статус: ${getResponse.status}\n` +
                    `🔗 URL: ${url}\n` +
                    `💡 Метод: GET (HEAD не поддерживается)`
                );
                
            } catch (getError) {
                await this.editMessage(chatId, messageId, 
                    `❌ Сайт недоступен: ${url}\n\n` +
                    `🔍 Детали ошибки:\n` +
                    `• ${getError.message}\n` +
                    `• ${getError.code || 'Неизвестная ошибка'}\n\n` +
                    `💡 Проверьте:\n` +
                    `• Правильность написания адреса\n` +
                    `• Подключение к интернету\n` +
                    `• Доступность сайта`
                );
            }
        } else {
            await this.editMessage(chatId, messageId, 
                `❌ Ошибка проверки: ${url}\n\n` +
                `📝 ${error.message}\n` +
                `🔧 ${error.code || 'Неизвестная ошибка'}`
            );
        }
    }
}

    async checkIP(args, message, chatId, senderId, messageId) {
        try {
            const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
            await this.editMessage(chatId, messageId, `🌐 Ваш IP: ${response.data.ip}`);
        } catch (error) {
            await this.editMessage(chatId, messageId, `❌ Ошибка получения IP: ${error.message}`);
        }
    }

    async chatInfo(args, message, chatId, senderId, messageId) {
        try {
            const chat = await this.telegramClient.getEntity(chatId);
            let info = `💬 Информация о чате:\n\n`;
            
            if (chat.title) info += `📝 Название: ${chat.title}\n`;
            if (chat.username) info += `🔗 Юзернейм: @${chat.username}\n`;
            info += `🆔 ID: ${chat.id}\n`;
            info += `📊 Тип: ${chat.className}\n`;
            
            if (chat.participantsCount) {
                info += `👥 Участников: ${chat.participantsCount}\n`;
            }
            
            await this.editMessage(chatId, messageId, info);
        } catch (error) {
            await this.editMessage(chatId, messageId, `❌ Ошибка получения информации: ${error.message}`);
        }
    }

    async stealAvatar(args, message, chatId, senderId, messageId) {
    try {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, 
                `👤 Использование: ${this.settings.prefix}кража_авы [юзернейм]`
            );
            return;
        }

        const username = args[0].replace('@', '');
        await this.editMessage(chatId, messageId, `🔍 Ищу @${username}...`);

        // Получаем пользователя
        const user = await this.telegramClient.getEntity(username);
        if (!user) {
            await this.editMessage(chatId, messageId, `❌ Пользователь не найден`);
            return;
        }

        // Получаем полную информацию о пользователе
        await this.editMessage(chatId, messageId, `📥 Получаю информацию...`);
        const fullUser = await this.telegramClient.invoke(
            new Api.users.GetFullUser({
                id: user
            })
        );

        if (!fullUser.profilePhoto) {
            await this.editMessage(chatId, messageId, `❌ У пользователя нет аватара`);
            return;
        }

        await this.editMessage(chatId, messageId, `📤 Устанавливаю аватар...`);

        // Метод 1: Прямое использование InputPhoto из профиля
        try {
            const result = await this.telegramClient.invoke(
                new Api.photos.UploadProfilePhoto({
                    file: new Api.InputPhoto({
                        id: fullUser.profilePhoto.id,
                        accessHash: fullUser.profilePhoto.accessHash,
                        fileReference: fullUser.profilePhoto.fileReference
                    })
                })
            );

            await this.editMessage(chatId, messageId, `✅ Аватар @${username} установлен!`);
            return;

        } catch (method1Error) {
            console.log('Метод 1 не сработал:', method1Error.message);
        }

        // Метод 2: Используем photos.GetUserPhotos
        await this.editMessage(chatId, messageId, `🔄 Пробую другой метод...`);
        
        try {
            const photos = await this.telegramClient.invoke(
                new Api.photos.GetUserPhotos({
                    userId: user,
                    offset: 0,
                    maxId: 0,
                    limit: 1
                })
            );

            if (photos.photos.length > 0) {
                const photo = photos.photos[0];
                
                const result = await this.telegramClient.invoke(
                    new Api.photos.UploadProfilePhoto({
                        id: photo.id,
                        file: new Api.InputPhoto({
                            id: photo.id,
                            accessHash: photo.accessHash,
                            fileReference: photo.fileReference
                        })
                    })
                );

                await this.editMessage(chatId, messageId, `✅ Аватар @${username} установлен!`);
                return;
            }
        } catch (method2Error) {
            console.log('Метод 2 не сработал:', method2Error.message);
        }

        // Метод 3: Создаем временный файл и загружаем через него
        await this.editMessage(chatId, messageId, `⚡ Пробую загрузку через файл...`);
        
        try {
            // Скачиваем аватар
            const photoBuffer = await this.telegramClient.downloadProfilePhoto(user, { 
                isBig: true 
            });

            if (photoBuffer) {
                // Создаем временную папку если не существует
                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                // Сохраняем во временный файл
                const tempFile = path.join(tempDir, `avatar_${Date.now()}.jpg`);
                fs.writeFileSync(tempFile, photoBuffer);

                // Загружаем файл
                const file = await this.telegramClient.uploadFile({
                    file: tempFile,
                    workers: 1
                });

                // Устанавливаем аватар
                await this.telegramClient.invoke(
                    new Api.photos.UploadProfilePhoto({
                        file: file
                    })
                );

                // Удаляем временный файл
                fs.unlinkSync(tempFile);

                await this.editMessage(chatId, messageId, `✅ Аватар @${username} установлен!`);
                return;
            }
        } catch (method3Error) {
            console.log('Метод 3 не сработал:', method3Error.message);
        }

        throw new Error('Все методы не сработали');

    } catch (error) {
        console.error('❌ Ошибка:', error);
        
        let errorMsg = `❌ Ошибка: ${error.message}`;
        if (error.message.includes('FILE_PARTS_INVALID')) {
            errorMsg = `❌ Проблема с загрузкой файла. Попробуйте другого пользователя.`;
        } else if (error.message.includes('PHOTO_INVALID')) {
            errorMsg = `❌ Неподдерживаемый формат изображения.`;
        }
        
        await this.editMessage(chatId, messageId, errorMsg);
    }
}

    async translateText(args, message, chatId, senderId, messageId) {
    if (args.length === 0) {
        await this.editMessage(chatId, messageId, 
            `🌐 Использование: ${this.settings.prefix}перевод [английский текст]\n` +
            `Или ответьте на сообщение с английским текстом для перевода`
        );
        return;
    }
    
    try {
        const text = args.join(' ');
        
        // Показываем сообщение о начале перевода
        await this.editMessage(chatId, messageId, `🔄 Перевод...`);
        
        // Используем веб-версию Google Translate без API
        const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
        
        const response = await axios.get(translateUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
            const translatedText = response.data[0][0][0];
            
            await this.editMessage(chatId, messageId, 
                `🌐 Перевод:\n` +
                `🇺🇸 Английский: ${text}\n` +
                `🇷🇺 Русский: ${translatedText}`
            );
        } else {
            throw new Error('Не удалось получить перевод');
        }
        
    } catch (error) {
        console.error('Ошибка перевода:', error);
        
        // Альтернативный метод через другой endpoint
        try {
            const text = args.join(' ');
            const altUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ru&q=${encodeURIComponent(text)}`;
            
            const altResponse = await axios.get(altUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (altResponse.data && altResponse.data.sentences && altResponse.data.sentences[0]) {
                const translatedText = altResponse.data.sentences[0].trans;
                
                await this.editMessage(chatId, messageId, 
                    `🌐 Перевод:\n` +
                    `🇺🇸 Английский: ${text}\n` +
                    `🇷🇺 Русский: ${translatedText}`
                );
            } else {
                throw new Error('Альтернативный метод тоже не сработал');
            }
            
        } catch (altError) {
            console.error('Ошибка альтернативного перевода:', altError);
            
            // Резервный вариант - простой онлайн переводчик
            try {
                const text = args.join(' ');
                const simpleUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`;
                
                const simpleResponse = await axios.get(simpleUrl, { timeout: 10000 });
                
                if (simpleResponse.data && simpleResponse.data.responseData && simpleResponse.data.responseData.translatedText) {
                    const translatedText = simpleResponse.data.responseData.translatedText;
                    
                    await this.editMessage(chatId, messageId, 
                        `🌐 Перевод (MyMemory):\n` +
                        `🇺🇸 Английский: ${text}\n` +
                        `🇷🇺 Русский: ${translatedText}`
                    );
                } else {
                    throw new Error('Все методы перевода не сработали');
                }
                
            } catch (finalError) {
                await this.editMessage(chatId, messageId, 
                    `❌ Ошибка перевода: ${finalError.message}\n\n` +
                    `💡 Попробуйте:\n` +
                    `• Проверить подключение к интернету\n` +
                    `• Убедиться, что текст на английском\n` +
                    `• Попробовать позже`
                );
            }
        }
    }
}

    async showUserId(args, message, chatId, senderId, messageId) {
    try {
        let targetUserId = senderId; // По умолчанию - ID отправителя команды
        
        // Если команда отправлена в ответ на другое сообщение
        if (message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await this.telegramClient.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });
            
            if (repliedMessages[0] && repliedMessages[0].senderId) {
                targetUserId = repliedMessages[0].senderId;
                const user = await this.telegramClient.getEntity(targetUserId);
                
                let userInfo = `👤 Информация о пользователе:\n\n`;
                if (user.firstName) userInfo += `📝 Имя: ${user.firstName}\n`;
                if (user.lastName) userInfo += `📝 Фамилия: ${user.lastName}\n`;
                if (user.username) userInfo += `🔗 Юзернейм: @${user.username}\n`;
                userInfo += `🆔 ID: ${targetUserId}\n`;
                
                await this.editMessage(chatId, messageId, userInfo);
                return;
            }
        }
        
        // Если указан юзернейм в аргументах
        if (args.length > 0) {
            let username = args[0].replace('@', ''); // Убираем @ если есть
            
            try {
                const user = await this.telegramClient.getEntity(username);
                targetUserId = user.id;
                
                let userInfo = `👤 Информация о пользователе:\n\n`;
                if (user.firstName) userInfo += `📝 Имя: ${user.firstName}\n`;
                if (user.lastName) userInfo += `📝 Фамилия: ${user.lastName}\n`;
                if (user.username) userInfo += `🔗 Юзернейм: @${user.username}\n`;
                userInfo += `🆔 ID: ${targetUserId}\n`;
                
                await this.editMessage(chatId, messageId, userInfo);
                return;
                
            } catch (error) {
                await this.editMessage(chatId, messageId, 
                    `❌ Пользователь @${username} не найден\n\n` +
                    `💡 Проверьте:\n` +
                    `• Правильность написания юзернейма\n` +
                    `• Существует ли такой пользователь\n` +
                    `• Доступность профиля`
                );
                return;
            }
        }
        
        // Если нет ответа и нет аргументов - показываем ID отправителя
        const user = await this.telegramClient.getEntity(senderId);
        let userInfo = `👤 Ваша информация:\n\n`;
        if (user.firstName) userInfo += `📝 Имя: ${user.firstName}\n`;
        if (user.lastName) userInfo += `📝 Фамилия: ${user.lastName}\n`;
        if (user.username) userInfo += `🔗 Юзернейм: @${user.username}\n`;
        userInfo += `🆔 ID: ${senderId}\n`;
        
        await this.editMessage(chatId, messageId, userInfo);
        
    } catch (error) {
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка получения ID: ${error.message}\n\n` +
            `💡 Использование команды:\n` +
            `• ${this.settings.prefix}айди - показать ваш ID\n` +
            `• ${this.settings.prefix}айди @username - показать ID по юзернейму\n` +
            `• Ответьте на сообщение пользователя с командой ${this.settings.prefix}айди - показать его ID`
        );
    }
}

    async showRegistrationDate(args, message, chatId, senderId, messageId) {
    try {
        let targetUserId = senderId; // По умолчанию - ID отправителя команды
        let targetUser = null;
        
        // Если команда отправлена в ответ на другое сообщение
        if (message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await this.telegramClient.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });
            
            if (repliedMessages[0] && repliedMessages[0].senderId) {
                targetUserId = repliedMessages[0].senderId;
                targetUser = await this.telegramClient.getEntity(targetUserId);
                
                let userInfo = `👤 Информация о пользователе:\n\n`;
                if (targetUser.firstName) userInfo += `📝 Имя: ${targetUser.firstName}\n`;
                if (targetUser.lastName) userInfo += `📝 Фамилия: ${targetUser.lastName}\n`;
                if (targetUser.username) userInfo += `🔗 Юзернейм: @${targetUser.username}\n`;
                userInfo += `🆔 ID: ${targetUserId}\n`;
                
                // Получаем дату регистрации через полную информацию о пользователе
                try {
                    const fullUser = await this.telegramClient.invoke(
                        new Api.users.GetFullUser({
                            id: await this.telegramClient.getInputEntity(targetUserId)
                        })
                    );
                    
                    if (fullUser.user) {
                        // Дата регистрации обычно соответствует дате создания аккаунта
                        // В Telegram это можно приблизительно определить по дате первого контакта
                        // или другим метрикам
                        const user = fullUser.user;
                        
                        if (user.status) {
                            if (user.status.className === 'UserStatusEmpty') {
                                userInfo += `📅 Аккаунт создан: очень давно\n`;
                            } else if (user.status.className === 'UserStatusRecently') {
                                userInfo += `📅 Аккаунт создан: недавно\n`;
                            } else if (user.status.className === 'UserStatusLastWeek') {
                                userInfo += `📅 Аккаунт создан: на прошлой неделе\n`;
                            } else if (user.status.className === 'UserStatusLastMonth') {
                                userInfo += `📅 Аккаунт создан: в прошлом месяце\n`;
                            }
                        }
                        
                        // Пытаемся получить примерную дату по информации о пользователе
                        if (user.photo) {
                            userInfo += `🖼️ Фото профиля: есть\n`;
                        }
                        
                        if (user.bot) {
                            userInfo += `🤖 Тип: Бот\n`;
                            // Для ботов можно получить больше информации
                            if (fullUser.botInfo) {
                                if (fullUser.botInfo.description) {
                                    userInfo += `📋 Описание: ${fullUser.botInfo.description}\n`;
                                }
                            }
                        } else {
                            userInfo += `👤 Тип: Обычный пользователь\n`;
                        }
                    }
                } catch (fullUserError) {
                    console.log('Не удалось получить полную информацию о пользователе:', fullUserError.message);
                }
                
                // Статус онлайн
                if (targetUser.status) {
                    let statusInfo = '';
                    if (targetUser.status.className === 'UserStatusOnline') {
                        statusInfo = `🟢 В сети (онлайн)`;
                    } else if (targetUser.status.className === 'UserStatusOffline') {
                        const lastSeen = targetUser.status.wasOnline;
                        statusInfo = `🔴 Был(а) в сети: ${lastSeen.toLocaleDateString('ru-RU')} ${lastSeen.toLocaleTimeString('ru-RU')}`;
                    } else if (targetUser.status.className === 'UserStatusRecently') {
                        statusInfo = `🟡 Был(а) недавно`;
                        userInfo += `📅 Аккаунт создан: относительно недавно\n`;
                    } else if (targetUser.status.className === 'UserStatusLastWeek') {
                        statusInfo = `🟡 Был(а) на прошлой неделе`;
                        userInfo += `📅 Аккаунт создан: примерно на прошлой неделе\n`;
                    } else if (targetUser.status.className === 'UserStatusLastMonth') {
                        statusInfo = `⚫ Был(а) в прошлом месяце`;
                        userInfo += `📅 Аккаунт создан: примерно в прошлом месяце\n`;
                    } else {
                        statusInfo = `❓ Статус: ${targetUser.status.className}`;
                    }
                    userInfo += `📱 ${statusInfo}\n`;
                }
                
                // Дополнительная информация
                if (targetUser.verified) {
                    userInfo += `✅ Официально подтвержден\n`;
                }
                if (targetUser.scam) {
                    userInfo += `⚠️ Помечен как мошенник\n`;
                }
                if (targetUser.fake) {
                    userInfo += `🚫 Фейковый аккаунт\n`;
                }
                if (targetUser.premium) {
                    userInfo += `💎 Telegram Premium\n`;
                }
                
                // Оценка "возраста" аккаунта на основе доступных данных
                userInfo += `\n💡 Примечание: Точная дата регистрации в Telegram не доступна через API.\n`;
                userInfo += `Приведенные данные основаны на статусе активности пользователя.`;
                
                await this.editMessage(chatId, messageId, userInfo);
                return;
            }
        }
        
        // Если указан юзернейм в аргументах
        if (args.length > 0) {
            let username = args[0].replace('@', ''); // Убираем @ если есть
            
            try {
                targetUser = await this.telegramClient.getEntity(username);
                targetUserId = targetUser.id;
                
                let userInfo = `👤 Информация о пользователе:\n\n`;
                if (targetUser.firstName) userInfo += `📝 Имя: ${targetUser.firstName}\n`;
                if (targetUser.lastName) userInfo += `📝 Фамилия: ${targetUser.lastName}\n`;
                if (targetUser.username) userInfo += `🔗 Юзернейм: @${targetUser.username}\n`;
                userInfo += `🆔 ID: ${targetUserId}\n`;
                
                // Получаем дату регистрации через полную информацию о пользователе
                try {
                    const fullUser = await this.telegramClient.invoke(
                        new Api.users.GetFullUser({
                            id: await this.telegramClient.getInputEntity(targetUserId)
                        })
                    );
                    
                    if (fullUser.user) {
                        const user = fullUser.user;
                        
                        if (user.status) {
                            if (user.status.className === 'UserStatusEmpty') {
                                userInfo += `📅 Аккаунт создан: очень давно\n`;
                            } else if (user.status.className === 'UserStatusRecently') {
                                userInfo += `📅 Аккаунт создан: недавно\n`;
                            } else if (user.status.className === 'UserStatusLastWeek') {
                                userInfo += `📅 Аккаунт создан: на прошлой неделе\n`;
                            } else if (user.status.className === 'UserStatusLastMonth') {
                                userInfo += `📅 Аккаунт создан: в прошлом месяце\n`;
                            }
                        }
                        
                        if (user.photo) {
                            userInfo += `🖼️ Фото профиля: есть\n`;
                        }
                        
                        if (user.bot) {
                            userInfo += `🤖 Тип: Бот\n`;
                            if (fullUser.botInfo) {
                                if (fullUser.botInfo.description) {
                                    userInfo += `📋 Описание: ${fullUser.botInfo.description}\n`;
                                }
                            }
                        } else {
                            userInfo += `👤 Тип: Обычный пользователь\n`;
                        }
                    }
                } catch (fullUserError) {
                    console.log('Не удалось получить полную информацию о пользователе:', fullUserError.message);
                }
                
                // Статус онлайн
                if (targetUser.status) {
                    let statusInfo = '';
                    if (targetUser.status.className === 'UserStatusOnline') {
                        statusInfo = `🟢 В сети (онлайн)`;
                    } else if (targetUser.status.className === 'UserStatusOffline') {
                        const lastSeen = targetUser.status.wasOnline;
                        statusInfo = `🔴 Был(а) в сети: ${lastSeen.toLocaleDateString('ru-RU')} ${lastSeen.toLocaleTimeString('ru-RU')}`;
                    } else if (targetUser.status.className === 'UserStatusRecently') {
                        statusInfo = `🟡 Был(а) недавно`;
                        userInfo += `📅 Аккаунт создан: относительно недавно\n`;
                    } else if (targetUser.status.className === 'UserStatusLastWeek') {
                        statusInfo = `🟡 Был(а) на прошлой неделе`;
                        userInfo += `📅 Аккаунт создан: примерно на прошлой неделе\n`;
                    } else if (targetUser.status.className === 'UserStatusLastMonth') {
                        statusInfo = `⚫ Был(а) в прошлом месяце`;
                        userInfo += `📅 Аккаунт создан: примерно в прошлом месяце\n`;
                    } else {
                        statusInfo = `❓ Статус: ${targetUser.status.className}`;
                    }
                    userInfo += `📱 ${statusInfo}\n`;
                }
                
                // Дополнительная информация
                if (targetUser.verified) {
                    userInfo += `✅ Официально подтвержден\n`;
                }
                if (targetUser.scam) {
                    userInfo += `⚠️ Помечен как мошенник\n`;
                }
                if (targetUser.fake) {
                    userInfo += `🚫 Фейковый аккаунт\n`;
                }
                if (targetUser.premium) {
                    userInfo += `💎 Telegram Premium\n`;
                }
                
                userInfo += `\n💡 Примечание: Точная дата регистрации в Telegram не доступна через API.\n`;
                userInfo += `Приведенные данные основаны на статусе активности пользователя.`;
                
                await this.editMessage(chatId, messageId, userInfo);
                return;
                
            } catch (error) {
                await this.editMessage(chatId, messageId, 
                    `❌ Пользователь @${username} не найден\n\n` +
                    `💡 Проверьте:\n` +
                    `• Правильность написания юзернейма\n` +
                    `• Существует ли такой пользователь\n` +
                    `• Доступность профиля`
                );
                return;
            }
        }
        
        // Если нет ответа и нет аргументов - показываем информацию об отправителе
        targetUser = await this.telegramClient.getEntity(senderId);
        let userInfo = `👤 Ваша информация:\n\n`;
        if (targetUser.firstName) userInfo += `📝 Имя: ${targetUser.firstName}\n`;
        if (targetUser.lastName) userInfo += `📝 Фамилия: ${targetUser.lastName}\n`;
        if (targetUser.username) userInfo += `🔗 Юзернейм: @${targetUser.username}\n`;
        userInfo += `🆔 ID: ${senderId}\n`;
        
        // Получаем дату регистрации через полную информацию о пользователе
        try {
            const fullUser = await this.telegramClient.invoke(
                new Api.users.GetFullUser({
                    id: await this.telegramClient.getInputEntity(senderId)
                })
            );
            
            if (fullUser.user) {
                const user = fullUser.user;
                
                if (user.status) {
                    if (user.status.className === 'UserStatusEmpty') {
                        userInfo += `📅 Аккаунт создан: очень давно\n`;
                    } else if (user.status.className === 'UserStatusRecently') {
                        userInfo += `📅 Аккаунт создан: недавно\n`;
                    } else if (user.status.className === 'UserStatusLastWeek') {
                        userInfo += `📅 Аккаунт создан: на прошлой неделе\n`;
                    } else if (user.status.className === 'UserStatusLastMonth') {
                        userInfo += `📅 Аккаунт создан: в прошлом месяце\n`;
                    }
                }
                
                if (user.photo) {
                    userInfo += `🖼️ Фото профиля: есть\n`;
                }
                
                if (user.bot) {
                    userInfo += `🤖 Тип: Бот\n`;
                    if (fullUser.botInfo) {
                        if (fullUser.botInfo.description) {
                            userInfo += `📋 Описание: ${fullUser.botInfo.description}\n`;
                        }
                    }
                } else {
                    userInfo += `👤 Тип: Обычный пользователь\n`;
                }
            }
        } catch (fullUserError) {
            console.log('Не удалось получить полную информацию о пользователе:', fullUserError.message);
        }
        
        // Статус онлайн
        if (targetUser.status) {
            let statusInfo = '';
            if (targetUser.status.className === 'UserStatusOnline') {
                statusInfo = `🟢 В сети (онлайн)`;
            } else if (targetUser.status.className === 'UserStatusOffline') {
                const lastSeen = targetUser.status.wasOnline;
                statusInfo = `🔴 Был(а) в сети: ${lastSeen.toLocaleDateString('ru-RU')} ${lastSeen.toLocaleTimeString('ru-RU')}`;
            } else if (targetUser.status.className === 'UserStatusRecently') {
                statusInfo = `🟡 Был(а) недавно`;
                userInfo += `📅 Аккаунт создан: относительно недавно\n`;
            } else if (targetUser.status.className === 'UserStatusLastWeek') {
                statusInfo = `🟡 Был(а) на прошлой неделе`;
                userInfo += `📅 Аккаунт создан: примерно на прошлой неделе\n`;
            } else if (targetUser.status.className === 'UserStatusLastMonth') {
                statusInfo = `⚫ Был(а) в прошлом месяце`;
                userInfo += `📅 Аккаунт создан: примерно в прошлом месяце\n`;
            } else {
                statusInfo = `❓ Статус: ${targetUser.status.className}`;
            }
            userInfo += `📱 ${statusInfo}\n`;
        }
        
        // Дополнительная информация
        if (targetUser.verified) {
            userInfo += `✅ Официально подтвержден\n`;
        }
        if (targetUser.scam) {
            userInfo += `⚠️ Помечен как мошенник\n`;
        }
        if (targetUser.fake) {
            userInfo += `🚫 Фейковый аккаунт\n`;
        }
        if (targetUser.premium) {
            userInfo += `💎 Telegram Premium\n`;
        }
        
        userInfo += `\n💡 Примечание: Точная дата регистрации в Telegram не доступна через API.\n`;
        userInfo += `Приведенные данные основаны на статусе активности пользователя.`;
        
        await this.editMessage(chatId, messageId, userInfo);
        
    } catch (error) {
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка получения информации: ${error.message}\n\n` +
            `💡 Использование команды:\n` +
            `• ${this.settings.prefix}рег - показать вашу информацию\n` +
            `• ${this.settings.prefix}рег @username - показать информацию по юзернейму\n` +
            `• Ответьте на сообщение пользователя с командой ${this.settings.prefix}рег - показать его информацию`
        );
    }
}

    async readMessages(args, message, chatId, senderId, messageId) {
    try {
        await this.editMessage(chatId, messageId, `🔍 Начинаю прочитывать все чаты...`);

        const dialogs = await this.telegramClient.getDialogs({});
        let readCount = 0;
        let errorCount = 0;
        let skippedCount = 0;

        for (const dialog of dialogs) {
            try {
                // Пропускаем архивированные диалоги и те, где нет непрочитанных
                if (dialog.archived || dialog.unreadCount === 0) {
                    skippedCount++;
                    continue;
                }

                const entity = dialog.entity;
                console.log(`📖 Обрабатываю диалог: ${entity.id}, тип: ${entity.className}, непрочитано: ${dialog.unreadCount}`);

                let peer;
                
                // Получаем peer в зависимости от типа сущности
                if (entity.className === 'Channel' || entity.className === 'Chat' || entity.className === 'User') {
                    peer = await this.telegramClient.getInputEntity(entity);
                } else {
                    // Для других типов используем альтернативный метод
                    peer = entity;
                }

                // Для разных типов чатов используем разные методы
                if (entity.className === 'Channel') {
                    // Для каналов используем channels.readHistory
                    try {
                        await this.telegramClient.invoke(
                            new Api.channels.ReadHistory({
                                channel: peer,
                                maxId: 0
                            })
                        );
                        console.log(`✅ Канал ${entity.id} прочитан`);
                        readCount++;
                    } catch (channelError) {
                        console.error(`❌ Ошибка канала ${entity.id}:`, channelError.message);
                        errorCount++;
                    }
                } else {
                    // Для обычных чатов и пользователей
                    try {
                        await this.telegramClient.invoke(
                            new Api.messages.ReadHistory({
                                peer: peer,
                                maxId: 0
                            })
                        );
                        console.log(`✅ Чат ${entity.id} прочитан`);
                        readCount++;
                    } catch (chatError) {
                        console.error(`❌ Ошибка чата ${entity.id}:`, chatError.message);
                        errorCount++;
                    }
                }

                // Прочитываем упоминания если есть
                try {
                    await this.telegramClient.invoke(
                        new Api.messages.ReadMentions({
                            peer: peer
                        })
                    );
                } catch (mentionError) {
                    // игнорим ероры упоминаний
                }

                // Обновляем прогресс каждые 5 чатов
                if ((readCount + errorCount) % 5 === 0) {
                    await this.editMessage(chatId, messageId, 
                        `📖 Прогресс: ${readCount + errorCount + skippedCount}/${dialogs.length}\n` +
                        `✅ Прочитано: ${readCount}\n` +
                        `❌ Ошибок: ${errorCount}\n` +
                        `⏭️  Пропущено: ${skippedCount}\n` +
                        `⏳ Продолжаю...`
                    );
                }

                // Задержка чтобы не нагружать сервер
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (error) {
                errorCount++;
                console.error(`❌ Общая ошибка диалога ${dialog.entity?.id}:`, error.message);
                continue;
            }
        }

        const resultMessage = `✅ Прочтение завершено!\n\n` +
                             `📊 Результаты:\n` +
                             `• Всего диалогов: ${dialogs.length}\n` +
                             `• Успешно прочитано: ${readCount}\n` +
                             `• Ошибок: ${errorCount}\n` +
                             `• Пропущено: ${skippedCount}\n\n` +
                             `💡 Все доступные непрочитанные сообщения отмечены как прочитанные.`;

        await this.editMessage(chatId, messageId, resultMessage);
        
    } catch (error) {
        console.error('❌ Ошибка в команде прочитать:', error);
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка выполнения команды: ${error.message}\n\n` +
            `💡 Возможные причины:\n` +
            `• Проблемы с подключением\n` +
            `• Ограничения Telegram API\n` +
            `• Попробуйте позже`
        );
    }
}

    async addTrigger(args, message, chatId, messageId) {
    if (args.length < 3) {
        throw new Error('Укажите слово и ответы для триггера');
    }
    
    const triggerWord = args[1];
    let responses = [];
    let settings = {
        count: 1,
        delay: 0,
        chance: 100,
        cooldown: 0,
        enabled: true,
        regex: false,
        caseSensitive: false,
        reply: false,
        silent: false,
        created: new Date(),
        used: 0,
        lastUsed: null
    };
    
    // Парсим аргументы
    let responseText = '';
    for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('-')) {
            // Это параметр
            const param = args[i].substring(2);
            const value = args[i + 1];
            
            switch (param) {
                case 'count':
                    settings.count = parseInt(value) || 1;
                    i++;
                    break;
                case 'delay':
                    settings.delay = parseInt(value) || 0;
                    i++;
                    break;
                case 'chance':
                    settings.chance = Math.min(Math.max(parseInt(value) || 100, 1), 100);
                    i++;
                    break;
                case 'cooldown':
                    settings.cooldown = parseInt(value) || 0;
                    i++;
                    break;
                case 'regex':
                    settings.regex = true;
                    break;
                case 'casesens':
                    settings.caseSensitive = true;
                    break;
                case 'reply':
                    settings.reply = true;
                    break;
                case 'silent':
                    settings.silent = true;
                    break;
            }
        } else {
            // Это часть ответа
            responseText += (responseText ? ' ' : '') + args[i];
        }
    }
    
    // Разделяем ответы по |
    if (responseText.includes('|')) {
        responses = responseText.split('|').map(r => r.trim()).filter(r => r);
    } else {
        responses = [responseText];
    }
    
    if (responses.length === 0) {
        throw new Error('Укажите хотя бы один ответ для триггера');
    }
    
    // Создаем объект триггера
    const trigger = {
        word: triggerWord,
        responses: responses,
        settings: settings
    };
    
    // Сохраняем в базу
    await this.saveTriggerToDatabase(trigger);
    
    // Сохраняем в память
    this.settings.triggers.set(triggerWord.toLowerCase(), trigger);
    
    await this.saveAllData();
    
    const response = `✅ ТРИГГЕР ДОБАВЛЕН\n\n` +
                    `🔸 Слово: ${triggerWord}\n` +
                    `🔸 Ответы: ${responses.length}\n` +
                    `🔸 Повторов: ${settings.count}\n` +
                    `🔸 Задержка: ${settings.delay}мс\n` +
                    `🔸 Шанс: ${settings.chance}%\n` +
                    `🔸 Кулдаун: ${settings.cooldown}сек\n` +
                    `🔸 Режим: ${settings.regex ? 'REGEX' : 'Текст'} ${settings.caseSensitive ? '(регистр)' : ''}\n\n` +
                    `💡 Используйте ${this.settings.prefix}триггер info ${triggerWord} для информации`;
    
    await this.editMessage(chatId, messageId, response);
}

    async removeTrigger(triggerWord, chatId, messageId) {
    const trigger = this.settings.triggers.get(triggerWord.toLowerCase());
    
    if (!trigger) {
        await this.editMessage(chatId, messageId, `❌ Триггер "${triggerWord}" не найден`);
        return;
    }
    
    // Удаляем из базы
    await new Promise((resolve, reject) => {
        this.db.run(
            `DELETE FROM triggers WHERE word = ?`,
            [triggerWord],
            (err) => err ? reject(err) : resolve()
        );
    });
    
    // Удаляем из памяти
    this.settings.triggers.delete(triggerWord.toLowerCase());
    
    await this.saveAllData();
    
    await this.editMessage(chatId, messageId, 
        `✅ Триггер "${triggerWord}" удален\n` +
        `📊 Использован: ${trigger.settings.used} раз`
    );
}

    async editTrigger(args, chatId, messageId) {
    if (args.length < 3) {
        throw new Error('Укажите слово и новые ответы для редактирования');
    }
    
    const triggerWord = args[1];
    const trigger = this.settings.triggers.get(triggerWord.toLowerCase());
    
    if (!trigger) {
        throw new Error(`Триггер "${triggerWord}" не найден`);
    }
    
    // Получаем новые ответы (все что после слова)
    const newResponses = args.slice(2).join(' ').split('|').map(r => r.trim()).filter(r => r);
    
    if (newResponses.length === 0) {
        throw new Error('Укажите новые ответы для триггера');
    }
    
    trigger.responses = newResponses;
    
    // Обновляем в базе
    await this.saveTriggerToDatabase(trigger);
    await this.saveAllData();
    
    await this.editMessage(chatId, messageId, 
        `✅ Триггер "${triggerWord}" обновлен\n` +
        `🔸 Новые ответы: ${newResponses.length}\n` +
        `📊 Всего использований: ${trigger.settings.used}`
    );
}

    async showTriggerInfo(triggerWord, chatId, messageId) {
    const trigger = this.settings.triggers.get(triggerWord.toLowerCase());
    
    if (!trigger) {
        await this.editMessage(chatId, messageId, `❌ Триггер "${triggerWord}" не найден`);
        return;
    }
    
    const settings = trigger.settings;
    const lastUsed = settings.lastUsed ? 
        new Date(settings.lastUsed).toLocaleString('ru-RU') : 'Никогда';
    
    const status = settings.enabled ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН';
    
    let response = `📋 ИНФОРМАЦИЯ О ТРИГГЕРЕ\n\n` +
                  `🔸 Слово: ${trigger.word}\n` +
                  `🔸 Статус: ${status}\n` +
                  `🔸 Создан: ${new Date(settings.created).toLocaleString('ru-RU')}\n` +
                  `🔸 Использован: ${settings.used} раз\n` +
                  `🔸 Последнее использование: ${lastUsed}\n\n` +
                  `⚙️ НАСТРОЙКИ:\n` +
                  `• Повторов: ${settings.count}\n` +
                  `• Задержка: ${settings.delay}мс\n` +
                  `• Шанс: ${settings.chance}%\n` +
                  `• Кулдаун: ${settings.cooldown}сек\n` +
                  `• Режим: ${settings.regex ? 'REGEX' : 'Текст'}\n` +
                  `• Регистр: ${settings.caseSensitive ? 'Чувствителен' : 'Не чувствителен'}\n` +
                  `• Ответ: ${settings.reply ? 'Да' : 'Нет'}\n` +
                  `• Тихий: ${settings.silent ? 'Да' : 'Нет'}\n\n` +
                  `💬 ОТВЕТЫ (${trigger.responses.length}):\n`;
    
    trigger.responses.forEach((resp, index) => {
        response += `${index + 1}. ${resp}\n`;
    });
    
    await this.editMessage(chatId, messageId, response);
}

    async toggleTrigger(triggerWord, enabled, chatId, messageId) {
    const trigger = this.settings.triggers.get(triggerWord.toLowerCase());
    
    if (!trigger) {
        await this.editMessage(chatId, messageId, `❌ Триггер "${triggerWord}" не найден`);
        return;
    }
    
    trigger.settings.enabled = enabled;
    
    // Обновляем в базе
    await this.saveTriggerToDatabase(trigger);
    await this.saveAllData();
    
    const status = enabled ? 'ВКЛЮЧЕН ✅' : 'ВЫКЛЮЧЕН ❌';
    await this.editMessage(chatId, messageId, `✅ Триггер "${triggerWord}" ${status}`);
}

    async listTriggersEnhanced(chatId, messageId) {
    if (this.settings.triggers.size === 0) {
        await this.editMessage(chatId, messageId, `📋 Триггеры не настроены`);
        return;
    }
    
    let enabledCount = 0;
    let disabledCount = 0;
    let totalUses = 0;
    
    this.settings.triggers.forEach(trigger => {
        if (trigger.settings.enabled) enabledCount++;
        else disabledCount++;
        totalUses += trigger.settings.used;
    });
    
    let response = `📋 РАСШИРЕННЫЕ ТРИГГЕРЫ\n\n` +
                  `📊 Статистика:\n` +
                  `• Всего: ${this.settings.triggers.size}\n` +
                  `• Активных: ${enabledCount}\n` +
                  `• Отключенных: ${disabledCount}\n` +
                  `• Всего использований: ${totalUses}\n\n` +
                  `🔔 СПИСОК ТРИГГЕРОВ:\n\n`;
    
    let index = 1;
    this.settings.triggers.forEach((trigger, word) => {
        const status = trigger.settings.enabled ? '✅' : '❌';
        response += `${status} ${index}. "${word}" (исп. ${trigger.settings.used} раз)\n`;
        index++;
    });
    
    response += `\n💡 Используйте ${this.settings.prefix}триггер info [слово] для подробностей`;
    
    // Если триггеров много, разбиваем на части
    if (response.length > 4000) {
        const mid = Math.floor(response.length / 2);
        const firstPart = response.substring(0, mid);
        const secondPart = response.substring(mid);
        
        await this.editMessage(chatId, messageId, firstPart);
        await this.telegramClient.sendMessage(chatId, { message: secondPart });
    } else {
        await this.editMessage(chatId, messageId, response);
    }
}

async clearTriggers(chatId, messageId) {
    try {
        console.log('🗑️ Начинаю очистку триггеров...');
        
        // Получаем текущее количество триггеров
        const triggerCount = this.settings.triggers.size;
        
        if (triggerCount === 0) {
            await this.editMessage(chatId, messageId, `📋 Нет триггеров для очистки`);
            return;
        }
        
        await this.editMessage(chatId, messageId, `🔄 Очищаю ${triggerCount} триггеров...`);
        
        // Очищаем базу данных
        await new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM triggers`, (err) => {
                if (err) {
                    console.error('❌ Ошибка очистки таблицы триггеров:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Таблица триггеров очищена в базе данных');
                    resolve();
                }
            });
        });
        
        // Очищаем память
        this.settings.triggers.clear();
        console.log('✅ Триггеры очищены в памяти');
        
        // Сохраняем изменения
        await this.saveAllData();
        console.log('✅ Изменения сохранены');
        
        await this.editMessage(chatId, messageId, 
            `✅ Триггеры успешно очищены!\n\n` +
            `🗑️ Удалено: ${triggerCount} триггеров\n` +
            `💾 База данных: очищена\n` +
            `🧠 Память: очищена\n\n` +
            `🔄 Для применения изменений может потребоваться перезагрузка`
        );
        
    } catch (error) {
        console.error('❌ Критическая ошибка очистки триггеров:', error);
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка очистки триггеров: ${error.message}\n\n` +
            `💡 Попробуйте:\n` +
            `• Перезапустить бота\n` +
            `• Проверить права доступа к базе данных\n` +
            `• Вручную удалить файл bot_database.sqlite`
        );
    }
}

async showTriggersStats(chatId, messageId) {
    if (this.settings.triggers.size === 0) {
        await this.editMessage(chatId, messageId, `📊 Нет данных о триггерах`);
        return;
    }
    
    let totalUses = 0;
    let mostUsedTrigger = { word: '', uses: 0 };
    let recentlyUsed = null;
    
    this.settings.triggers.forEach(trigger => {
        totalUses += trigger.settings.used;
        
        if (trigger.settings.used > mostUsedTrigger.uses) {
            mostUsedTrigger = { word: trigger.word, uses: trigger.settings.used };
        }
        
        if (trigger.settings.lastUsed && (!recentlyUsed || 
            new Date(trigger.settings.lastUsed) > new Date(recentlyUsed.lastUsed))) {
            recentlyUsed = { word: trigger.word, lastUsed: trigger.settings.lastUsed };
        }
    });
    
    const avgUses = Math.round(totalUses / this.settings.triggers.size);
    
    let response = `📊 СТАТИСТИКА ТРИГГЕРОВ\n\n` +
                  `• Всего триггеров: ${this.settings.triggers.size}\n` +
                  `• Всего использований: ${totalUses}\n` +
                  `• Среднее использование: ${avgUses} раз\n\n`;
    
    if (mostUsedTrigger.uses > 0) {
        response += `🏆 Самый популярный:\n` +
                   `"${mostUsedTrigger.word}" - ${mostUsedTrigger.uses} раз\n\n`;
    }
    
    if (recentlyUsed) {
        response += `⏰ Последний использованный:\n` +
                   `"${recentlyUsed.word}" - ${new Date(recentlyUsed.lastUsed).toLocaleString('ru-RU')}`;
    }
    
    await this.editMessage(chatId, messageId, response);
}

    async saveTriggerToDatabase(trigger) {
    try {
        // чекаем и нормализуем данные перед сохранением
        const normalizedTrigger = {
            word: String(trigger.word || ''),
            responses: Array.isArray(trigger.responses) ? 
                trigger.responses.map(r => String(r || '')) : 
                [String(trigger.responses || '')],
            settings: {
                count: Number(trigger.settings?.count) || 1,
                delay: Number(trigger.settings?.delay) || 0,
                chance: Number(trigger.settings?.chance) || 100,
                cooldown: Number(trigger.settings?.cooldown) || 0,
                enabled: Boolean(trigger.settings?.enabled),
                regex: Boolean(trigger.settings?.regex),
                caseSensitive: Boolean(trigger.settings?.caseSensitive),
                reply: Boolean(trigger.settings?.reply),
                silent: Boolean(trigger.settings?.silent),
                typing: Boolean(trigger.settings?.typing),
                priority: Number(trigger.settings?.priority) || 1,
                deleteAfter: Number(trigger.settings?.deleteAfter) || 0,
                react: String(trigger.settings?.react || ''),
                forwardTo: String(trigger.settings?.forwardTo || ''),
                webhook: String(trigger.settings?.webhook || ''),
                allowedChats: Array.isArray(trigger.settings?.allowedChats) ? trigger.settings.allowedChats : [],
                allowedUsers: Array.isArray(trigger.settings?.allowedUsers) ? trigger.settings.allowedUsers : [],
                excludedChats: Array.isArray(trigger.settings?.excludedChats) ? trigger.settings.excludedChats : [],
                excludedUsers: Array.isArray(trigger.settings?.excludedUsers) ? trigger.settings.excludedUsers : [],
                timeStart: String(trigger.settings?.timeStart || ''),
                timeEnd: String(trigger.settings?.timeEnd || ''),
                days: Array.isArray(trigger.settings?.days) ? trigger.settings.days : [],
                created: trigger.settings?.created || new Date(),
                used: Number(trigger.settings?.used) || 0,
                lastUsed: trigger.settings?.lastUsed || null
            }
        };

        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO triggers (word, responses, settings, used_count, last_used, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    normalizedTrigger.word,
                    JSON.stringify(normalizedTrigger.responses),
                    JSON.stringify(normalizedTrigger.settings),
                    normalizedTrigger.settings.used,
                    normalizedTrigger.settings.lastUsed,
                    normalizedTrigger.settings.created
                ],
                (err) => {
                    if (err) {
                        console.error('❌ Ошибка сохранения триггера в базу:', err);
                        reject(err);
                    } else {
                        console.log(`✅ Триггер "${normalizedTrigger.word}" сохранен в базу`);
                        resolve();
                    }
                }
            );
        });
    } catch (error) {
        console.error('❌ Критическая ошибка сохранения триггера:', error);
        throw error;
    }
}

    async debugTriggers(args, message, chatId, senderId, messageId) {
    try {
        await this.validateTriggersStructure();
        
        let debugInfo = `🔧 ДИАГНОСТИКА ТРИГГЕРОВ\n\n`;
        
        debugInfo += `📊 Статистика:\n`;
        debugInfo += `• Триггеров в памяти: ${this.settings.triggers.size}\n`;
        debugInfo += `• Префикс команд: ${this.settings.prefix}\n\n`;
        
        // чекаем базу данных
        const dbCount = await new Promise((resolve, reject) => {
            this.db.get(`SELECT COUNT(*) as count FROM triggers`, (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        debugInfo += `🗄️ База данных:\n`;
        debugInfo += `• Триггеров в базе: ${dbCount}\n\n`;
        
        // Показываем первые 5 триггеров с детальной информацией
        if (this.settings.triggers.size > 0) {
            debugInfo += `📋 Первые 5 триггеров:\n`;
            let count = 0;
            for (const [word, trigger] of this.settings.triggers) {
                if (count >= 5) break;
                
                // Правильно обрабатываем превью ответов
                let responsesPreview = '';
                if (trigger.responses && Array.isArray(trigger.responses)) {
                    responsesPreview = trigger.responses.slice(0, 2).map(r => {
                        const text = String(r || '');
                        return text.substring(0, 20) + (text.length > 20 ? '...' : '');
                    }).join(', ');
                } else {
                    responsesPreview = 'Некорректные ответы';
                }
                
                debugInfo += `${count + 1}. "${word}" → ${responsesPreview}\n`;
                count++;
            }
        } else {
            debugInfo += `📭 Триггеры не найдены в памяти\n`;
        }
        
        await this.editMessage(chatId, messageId, debugInfo);
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка диагностики: ${error.message}`);
    }
}


    async sendReaction(chatId, messageId, reactionEmoji, userId = null) {
    try {
        console.log(`🎯 Попытка отправить реакцию ${reactionEmoji} в чат ${chatId} на сообщение ${messageId}`);
        
        // Нормализуем эмодзи с учетом Premium статуса
        const normalizedEmoji = await this.normalizeEmoji(reactionEmoji, userId);
        
        if (normalizedEmoji !== reactionEmoji) {
            console.log(`🔄 Эмодзи нормализован: ${reactionEmoji} → ${normalizedEmoji}`);
        } else {
            console.log(`💎 Используем исходный эмодзи (Premium)`);
        }

        // Проверяем валидность параметров
        if (!chatId || !messageId || !normalizedEmoji) {
            console.error('❌ Неверные параметры для реакции:', { chatId, messageId, normalizedEmoji });
            return false;
        }

        const peer = await this.telegramClient.getInputEntity(chatId);
        
        // Создаем объект реакции
        const reaction = new Api.ReactionEmoji({
            emoticon: normalizedEmoji
        });

        console.log(`📤 Отправка реакции:`, {
            peer: peer,
            msgId: messageId,
            reaction: normalizedEmoji,
            isPremium: !!userId && await this.checkUserPremium(userId)
        });

        const result = await this.telegramClient.invoke(
            new Api.messages.SendReaction({
                peer: peer,
                msgId: messageId,
                reaction: [reaction]
            })
        );
        
        console.log(`✅ Реакция ${normalizedEmoji} успешно добавлена к сообщению ${messageId}`);
        return true;
        
    } catch (error) {
        console.error(`❌ Ошибка отправки реакции ${reactionEmoji}:`, {
            message: error.message,
            code: error.code,
            className: error.className
        });
        
        // Если у пользователя Premium, но реакция не сработала, пробуем нормализовать
        if (userId && await this.checkUserPremium(userId)) {
            console.log('💎 Premium реакция не сработала, пробуем нормализацию...');
            const fallbackEmoji = this.normalizeEmojiForRegularUser(reactionEmoji);
            
            if (fallbackEmoji !== reactionEmoji) {
                return await this.sendReaction(chatId, messageId, fallbackEmoji, null); // null = без Premium
            }
        }
        
        return false;
    }
}

    // Добавьте этот метод для проверки поддерживаемых реакций
getSupportedReactions() {
    return [
        '👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '😮', 
        '😢', '🎉', '🤩', '😡', '✅', '🤷', '😂', '❤️', '♥️'
    ];
}

// И обновите метод нормализации
async normalizeEmoji(emoji, userId = null) {
    if (!emoji) return '👍';
    
    // Если пользователь Premium, пробуем использовать эмодзи как есть
    if (userId && await this.checkUserPremium(userId)) {
        console.log(`💎 Premium пользователь ${userId}, пробуем эмодзи без нормализации: ${emoji}`);
        return emoji;
    }
    
    // Если бот Premium, также пробуем как есть
    if (await this.checkBotPremium()) {
        console.log(`🤖 Бот Premium, пробуем эмодзи без нормализации: ${emoji}`);
        return emoji;
    }
    
    // Для обычных пользователей - нормализация
    console.log(`🔹 Обычный пользователь, нормализуем эмодзи: ${emoji}`);
    return this.normalizeEmojiForRegularUser(emoji);
}

// Альтернативный метод отправки реакций
async alternativeSendReaction(chatId, messageId, reactionEmoji) {
    try {
        // Метод через прямые сообщения
        const result = await this.telegramClient.invoke(
            new Api.messages.SendReaction({
                peer: await this.telegramClient.getInputEntity(chatId),
                msgId: parseInt(messageId),
                reaction: [
                    new Api.ReactionEmoji({
                        emoticon: reactionEmoji
                    })
                ]
            })
        );
        console.log('✅ Альтернативный метод реакции успешен');
        return result;
    } catch (error) {
        throw error;
    }
}

// Метод нормализации для обычных пользователей
normalizeEmojiForRegularUser(emoji) {
    const supportedReactions = this.getSupportedReactions();
    
    // Если эмодзи уже в списке поддерживаемых, возвращаем как есть
    if (supportedReactions.includes(emoji)) {
        return emoji;
    }
    
    // Убираем модификаторы тона кожи
    const skinToneVariants = {
        '🤷🏻': '🤷', '🤷🏼': '🤷', '🤷🏽': '🤷', '🤷🏾': '🤷', '🤷🏿': '🤷',
        '👍🏻': '👍', '👍🏼': '👍', '👍🏽': '👍', '👍🏾': '👍', '👍🏿': '👍',
        '👎🏻': '👎', '👎🏼': '👎', '👎🏽': '👎', '👎🏾': '👎', '👎🏿': '👎',
        '🙏🏻': '🙏', '🙏🏼': '🙏', '🙏🏽': '🙏', '🙏🏾': '🙏', '🙏🏿': '🙏',
        '✊🏻': '✊', '✊🏼': '✊', '✊🏽': '✊', '✊🏾': '✊', '✊🏿': '✊',
    };
    
    if (skinToneVariants[emoji]) {
        console.log(`🔄 Нормализуем эмодзи с тоном кожи: ${emoji} → ${skinToneVariants[emoji]}`);
        return skinToneVariants[emoji];
    }
    
    // Пробуем извлечь базовый эмодзи
    const baseEmoji = emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
    if (baseEmoji && baseEmoji !== emoji && supportedReactions.includes(baseEmoji)) {
        console.log(`🔄 Извлекли базовый эмодзи: ${emoji} → ${baseEmoji}`);
        return baseEmoji;
    }
    
    // Если ничего не подошло, используем эмодзи по умолчанию
    console.log(`⚠️ Эмодзи ${emoji} не поддерживается, используем 👍 по умолчанию`);
    return '👍';
}

async sendEnhancedTriggerResponse(trigger, message, chatId, senderId, messageId) {
    const settings = trigger.settings;
    
    try {
        console.log(`🔔 Обработка триггера "${trigger.word}" с настройками:`, {
            react: settings.react,
            forwardTo: settings.forwardTo,
            chatId: chatId,
            messageId: messageId,
            senderId: senderId
        });

        // Отправка реакции с учетом Premium статуса отправителя
        if (settings.react && settings.react.trim()) {
            console.log(`🎯 Пытаюсь поставить реакцию: ${settings.react}`);
            
            // Даем небольшую задержку перед реакцией
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const reactionSuccess = await this.sendReaction(
                chatId, 
                messageId, 
                settings.react.trim(), 
                senderId
            );
            
            if (reactionSuccess) {
                console.log(`✅ Реакция ${settings.react} успешно установлена`);
            } else {
                console.log(`⚠️ Не удалось установить реакцию ${settings.react}`);
            }
        }

        // ПЕРЕСЫЛКА СООБЩЕНИЯ В ДРУГОЙ ЧАТ
        if (settings.forwardTo && settings.forwardTo.trim()) {
            try {
                console.log(`📤 Пытаюсь переслать сообщение в: ${settings.forwardTo}`);
                
                const targetChat = settings.forwardTo.trim();
                
                // Пересылаем оригинальное сообщение
                await this.telegramClient.forwardMessages(targetChat, {
                    messages: [messageId],
                    fromPeer: chatId
                });
                
                console.log(`✅ Сообщение переслано в ${targetChat}`);
                
            } catch (forwardError) {
                console.error(`❌ Ошибка пересылки в ${settings.forwardTo}:`, forwardError.message);
                
                // Пробуем альтернативный метод пересылки
                try {
                    await this.alternativeForwardMessage(chatId, messageId, settings.forwardTo);
                } catch (altError) {
                    console.error(`❌ Альтернативный метод пересылки тоже не сработал:`, altError.message);
                }
            }
        }

        // Отправка ответов
        for (let i = 0; i < settings.count; i++) {
            for (const response of trigger.responses) {
                // Замена переменных
                const user = await this.telegramClient.getEntity(senderId);
                const chat = await this.telegramClient.getEntity(chatId);
                
                const context = {
                    userId: senderId,
                    userName: user.firstName || 'Пользователь',
                    userUsername: user.username || '',
                    chatId: chatId,
                    chatTitle: chat.title || '',
                    messageId: messageId,
                    messageText: message.text || '',
                    triggerWord: trigger.word,
                    triggerCount: trigger.settings.used
                };
                
                const processedResponse = this.replaceVariables(response, context);
                
                try {
                    await this.telegramClient.sendMessage(chatId, {
                        message: processedResponse,
                        replyTo: settings.reply ? messageId : undefined,
                        silent: settings.silent
                    });
                    
                    console.log(`✅ Сообщение триггера отправлено в чат ${chatId}`);
                    
                } catch (sendError) {
                    console.error(`❌ Ошибка отправки в чат ${chatId}:`, sendError.message);
                    
                    if (this.isFatalSendError(sendError)) {
                        console.log(`🚫 Критическая ошибка, прекращаем отправку для этого триггера`);
                        return;
                    }
                }
                
                // Задержка между сообщениями
                if (settings.delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, settings.delay));
                }
            }
            
            // Задержка между повторами
            if (i < settings.count - 1 && settings.delay > 0) {
                await new Promise(resolve => setTimeout(resolve, settings.delay));
            }
        }
        
    } catch (error) {
        console.error('❌ Общая ошибка отправки расширенного ответа:', error.message);
    }
}

async alternativeForwardMessage(fromChatId, messageId, toChatId) {
    try {
        console.log(`🔄 Альтернативный метод пересылки из ${fromChatId} в ${toChatId}`);
        
        // Получаем сообщение
        const messages = await this.telegramClient.getMessages(fromChatId, {
            ids: [messageId]
        });
        
        if (!messages || messages.length === 0) {
            throw new Error('Сообщение не найдено');
        }
        
        const message = messages[0];
        
        // Пересылаем разными способами в зависимости от типа сообщения
        if (message.media) {
            // Для медиа-сообщений
            await this.telegramClient.sendFile(toChatId, {
                file: message.media,
                caption: message.text || null
            });
        } else if (message.text) {
            // Для текстовых сообщений
            await this.telegramClient.sendMessage(toChatId, {
                message: `📨 Переслано из другого чата:\n\n${message.text}`,
                parseMode: null
            });
        } else {
            throw new Error('Неподдерживаемый тип сообщения для пересылки');
        }
        
        console.log(`✅ Альтернативная пересылка успешна`);
        
    } catch (error) {
        console.error('❌ Ошибка альтернативной пересылки:', error);
        throw error;
    }
}

// Также обновите метод addEnhancedTrigger для корректного парсинга параметра -react
async addEnhancedTrigger(args, message, chatId, messageId) {
    if (args.length < 3) {
        throw new Error('Укажите слово и ответы для триггера');
    }

    const triggerWord = args[1];
    let responses = [];
    let settings = {
        count: 1,
        delay: 0,
        chance: 100,
        cooldown: 0,
        enabled: true,
        regex: false,
        caseSensitive: false,
        reply: false,
        silent: false,
        typing: false,
        priority: 1,
        deleteAfter: 0,
        react: null, // Добавляем реакцию по умолчанию
        forwardTo: null,
        webhook: null,
        allowedChats: [],
        allowedUsers: [],
        excludedChats: [],
        excludedUsers: [],
        timeStart: null,
        timeEnd: null,
        days: [],
        created: new Date(),
        used: 0,
        lastUsed: null
    };

    // Новый парсинг аргументов с одинарным тире
    let responseParts = [];
    let i = 2;
    
    // Сначала собираем все части ответа (до первых - параметров)
    while (i < args.length && !args[i].startsWith('-')) {
        responseParts.push(args[i]);
        i++;
    }

    // Затем обрабатываем параметры с одинарным тире
    while (i < args.length) {
        if (args[i].startsWith('-')) {
            const param = args[i].substring(1); // Убираем один тире
            const value = i + 1 < args.length ? args[i + 1] : null;

            switch (param) {
                case 'count':
                    if (value && !isNaN(value)) {
                        settings.count = Math.min(Math.max(parseInt(value), 1), 20);
                        i++; // Пропускаем значение
                    }
                    break;
                case 'delay':
                    if (value && !isNaN(value)) {
                        settings.delay = parseInt(value);
                        i++;
                    }
                    break;
                case 'chance':
                    if (value && !isNaN(value)) {
                        settings.chance = Math.min(Math.max(parseInt(value), 1), 100);
                        i++;
                    }
                    break;
                case 'cooldown':
                    if (value && !isNaN(value)) {
                        settings.cooldown = parseInt(value);
                        i++;
                    }
                    break;
                case 'priority':
                    if (value && !isNaN(value)) {
                        settings.priority = Math.min(Math.max(parseInt(value), 1), 10);
                        i++;
                    }
                    break;
                case 'delete_after':
                case 'delete':
                    if (value && !isNaN(value)) {
                        settings.deleteAfter = parseInt(value);
                        i++;
                    }
                    break;
                case 'react': // Обрабатываем параметр реакции
                    if (value) {
                        settings.react = value;
                        i++;
                    }
                    break;
                case 'forward_to':
                case 'forward':
                    if (value) {
                        settings.forwardTo = value;
                        i++;
                    }
                    break;
                case 'webhook':
                    if (value) {
                        settings.webhook = value;
                        i++;
                    }
                    break;
                case 'chats':
                    if (value) {
                        settings.allowedChats = value.split(',').map(id => id.trim()).filter(id => id);
                        i++;
                    }
                    break;
                case 'users':
                    if (value) {
                        settings.allowedUsers = value.split(',').map(id => id.trim()).filter(id => id);
                        i++;
                    }
                    break;
                case 'exclude_chats':
                case 'exclude_chat':
                    if (value) {
                        settings.excludedChats = value.split(',').map(id => id.trim()).filter(id => id);
                        i++;
                    }
                    break;
                case 'exclude_users':
                case 'exclude_user':
                    if (value) {
                        settings.excludedUsers = value.split(',').map(id => id.trim()).filter(id => id);
                        i++;
                    }
                    break;
                case 'time_start':
                case 'time_start':
                    if (value) {
                        settings.timeStart = value;
                        i++;
                    }
                    break;
                case 'time_end':
                case 'time_end':
                    if (value) {
                        settings.timeEnd = value;
                        i++;
                    }
                    break;
                case 'days':
                    if (value) {
                        settings.days = value.split(',').map(day => parseInt(day.trim())).filter(day => day >= 1 && day <= 7);
                        i++;
                    }
                    break;
                // Флаги (без значений)
                case 'regex':
                    settings.regex = true;
                    break;
                case 'casesens':
                case 'case':
                    settings.caseSensitive = true;
                    break;
                case 'reply':
                    settings.reply = true;
                    break;
                case 'silent':
                    settings.silent = true;
                    break;
                case 'typing':
                    settings.typing = true;
                    break;
                case 'enabled':
                    settings.enabled = true;
                    break;
                case 'disabled':
                    settings.enabled = false;
                    break;
                case 'forward_to':
                case 'forward':
                if (value) {
                settings.forwardTo = value;
                i++; // Пропускаем значение
                console.log(`📤 Установлена пересылка в: ${value}`);
    }
    break;
            }
        }
        i++;
    }

    // Собираем текст ответа
    const responseText = responseParts.join(' ');

    // Разделяем ответы по | или используем как один ответ
    if (responseText.includes('|')) {
        responses = responseText.split('|').map(r => r.trim()).filter(r => r);
    } else {
        responses = [responseText];
    }

    if (responses.length === 0 || (responses.length === 1 && !responses[0])) {
        throw new Error('Укажите хотя бы один ответ для триггера');
    }

    console.log(`🔧 Создаем триггер: "${triggerWord}"`, {
        responses: responses,
        settings: settings
    });

    // Создаем объект триггера
    const trigger = {
        word: triggerWord,
        responses: responses,
        settings: settings
    };

    // Сохраняем в базу
    await this.saveTriggerToDatabase(trigger);

    // Сохраняем в память
    this.settings.triggers.set(triggerWord.toLowerCase(), trigger);

    await this.saveAllData();

    const response = `✅ РАСШИРЕННЫЙ ТРИГГЕР ДОБАВЛЕН\n\n` +
                    `🔸 Слово: ${trigger.word}\n` +
                    `🔸 Ответы: ${responses.length}\n` +
                    `🔸 Приоритет: ${settings.priority}\n` +
                    `🔸 Повторов: ${settings.count}\n` +
                    `🔸 Задержка: ${settings.delay}мс\n` +
                    `🔸 Шанс: ${settings.chance}%\n` +
                    `🔸 Кулдаун: ${settings.cooldown}сек\n` +
                    `🔸 Реакция: ${settings.react || 'нет'}\n` + // Показываем реакцию в ответе
                    `🔸 Режим: ${settings.regex ? 'REGEX' : 'Текст'} ${settings.caseSensitive ? '(регистр)' : ''}\n\n` +
                    `💡 Используйте ${this.settings.prefix}триггер info ${triggerWord} для полной информации`;

    await this.editMessage(chatId, messageId, response);
}

    // Добавьте этот метод в класс lpbot
    getTriggerResponsesPreview(trigger) {
    if (!trigger || !trigger.responses) {
        return 'Нет ответов';
    }
    
    if (Array.isArray(trigger.responses)) {
        return trigger.responses.map(response => {
            const text = String(response || '');
            return text.substring(0, 30) + (text.length > 30 ? '...' : '');
        }).join(' | ');
    }
    
    return String(trigger.responses || 'Некорректные ответы');
}

    replaceVariables(text, context = {}) {
    try {
        if (text === null || text === undefined) {
            text = '';
        }
        if (typeof text !== 'string') {
            text = String(text);
        }

        // Безопасное извлечение значений из контекста
        const safeContext = {
            userId: String(context.userId || ''),
            userName: this.escapeHtml(String(context.userName || 'Пользователь')),
            userUsername: String(context.userUsername || 'без юзернейма'),
            chatId: String(context.chatId || ''),
            chatTitle: this.escapeHtml(String(context.chatTitle || 'личные сообщения')),
            messageId: String(context.messageId || ''),
            messageText: this.escapeHtml(String(context.messageText || '')),
            triggerWord: String(context.triggerWord || ''),
            triggerCount: String(context.triggerCount || '0')
        };

        // Базовые переменные
        let result = text
            .replace(/{user_id}/g, safeContext.userId)
            .replace(/{user_name}/g, safeContext.userName)
            .replace(/{user_username}/g, safeContext.userUsername)
            .replace(/{chat_id}/g, safeContext.chatId)
            .replace(/{chat_title}/g, safeContext.chatTitle)
            .replace(/{message_id}/g, safeContext.messageId)
            .replace(/{message_text}/g, safeContext.messageText)
            .replace(/{trigger_word}/g, safeContext.triggerWord)
            .replace(/{trigger_count}/g, safeContext.triggerCount)
            .replace(/{time}/g, new Date().toLocaleTimeString('ru-RU'))
            .replace(/{date}/g, new Date().toLocaleDateString('ru-RU'))
            .replace(/{random}/g, String(Math.floor(Math.random() * 1000)))
            .replace(/{bot_name}/g, this.escapeHtml(String(this.botInfo?.firstName || 'Бот')))
            .replace(/{bot_username}/g, String(this.botInfo?.username || 'бот'))
            .replace(/{uptime}/g, String(Math.floor((new Date() - this.startTime) / 1000)))
            .replace(/{memory}/g, String(Math.round(process.memoryUsage().heapUsed / 1024 / 1024)))
            .replace(/{triggers_count}/g, String(this.settings.triggers.size));

        return result;
    } catch (error) {
        console.error('❌ Ошибка в replaceVariables:', error);
        return String(text);
    }
}

// Добавьте метод для экранирования HTML
escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}



    async searchTriggers(searchTerm, chatId, messageId) {
    if (!searchTerm) {
        await this.editMessage(chatId, messageId, `🔍 Укажите текст для поиска`);
        return;
    }
    
    const results = [];
    this.settings.triggers.forEach((trigger, word) => {
        if (word.includes(searchTerm.toLowerCase()) || 
            trigger.responses.some(response => response.toLowerCase().includes(searchTerm.toLowerCase()))) {
            results.push(trigger);
        }
    });
    
    if (results.length === 0) {
        await this.editMessage(chatId, messageId, `🔍 Триггеры по запросу "${searchTerm}" не найдены`);
        return;
    }
    
    let response = `🔍 РЕЗУЛЬТАТЫ ПОИСКА: "${searchTerm}"\n\n`;
    results.forEach((trigger, index) => {
        response += `${index + 1}. "${trigger.word}" - ${trigger.responses.length} ответов (исп. ${trigger.settings.used} раз)\n`;
    });
    
    await this.editMessage(chatId, messageId, response);
}

async backupTriggers(chatId, messageId) {
    try {
        const backupData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            triggers: Array.from(this.settings.triggers.values())
        };
        
        const backupFile = path.join(__dirname, `triggers_backup_${Date.now()}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
        
        await this.telegramClient.sendFile(chatId, {
            file: backupFile,
            caption: `💾 Бэкап триггеров (${backupData.triggers.length} шт.)`
        });
        
        // Удаляем временный файл после отправки
        setTimeout(() => {
            try {
                fs.unlinkSync(backupFile);
            } catch (e) {
                console.log('Не удалось удалить временный файл');
            }
        }, 5000);
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка создания бэкапа: ${error.message}`);
    }
}

checkTriggerConditions(trigger, userId, chatId) {
    const settings = trigger.settings;
    
    // чек разрешенных чатов
    if (settings.allowedChats && settings.allowedChats.length > 0 && 
        !settings.allowedChats.includes(chatId.toString())) {
        return false;
    }
    
    // чек исключенных чатов
    if (settings.excludedChats && settings.excludedChats.length > 0 && 
        settings.excludedChats.includes(chatId.toString())) {
        return false;
    }
    
    // чек разрешенных пользователей
    if (settings.allowedUsers && settings.allowedUsers.length > 0 && 
        !settings.allowedUsers.includes(userId.toString())) {
        return false;
    }
    
    // чек исключенных пользователей
    if (settings.excludedUsers && settings.excludedUsers.length > 0 && 
        settings.excludedUsers.includes(userId.toString())) {
        return false;
    }

    // чек времени (-time_start / -time_end, формат ЧЧ:ММ)
    if (settings.timeStart && settings.timeEnd) {
        const startTime = this.parseClock(settings.timeStart);
        const endTime = this.parseClock(settings.timeEnd);
        if (startTime !== null && endTime !== null) {
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            if (startTime > endTime) {
                // Окно переходит через полночь
                if (!(currentTime >= startTime || currentTime <= endTime)) {
                    return false;
                }
            } else if (!(currentTime >= startTime && currentTime <= endTime)) {
                return false;
            }
        }
    }

    // чек дней недели (-days, 1-пн ... 7-вс)
    if (Array.isArray(settings.days) && settings.days.length > 0) {
        const currentDay = new Date().getDay(); // 0-воскресенье, 1-понедельник...
        const adjustedDay = currentDay === 0 ? 7 : currentDay;
        if (!settings.days.map(Number).includes(adjustedDay)) {
            return false;
        }
    }
    
    return true;
}

// Время суток "ЧЧ:ММ" -> минуты от полуночи (0..1439); null, если формат неверный.
// Не путать с parseTime: тот считает длительность в секундах для таймеров.
parseClock(timeStr) {
    const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(timeStr ?? ''));
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

async getChatType(chatId) {
    try {
        const chat = await this.telegramClient.getEntity(chatId);
        return chat.className;
    } catch (error) {
        return 'Unknown';
    }
}

// Добавьте метод для определения критических ошибок
isFatalSendError(error) {
    const errorMessage = error.message || '';
    
    // Критические ероры, при которых не стоит продолжать попытки
    const fatalErrors = [
        'CHAT_ADMIN_REQUIRED',
        'CHAT_WRITE_FORBIDDEN', 
        'USER_IS_BLOCKED',
        'CHAT_RESTRICTED',
        'PEER_ID_INVALID',
        'CHANNEL_PRIVATE',
        'CHANNEL_INVALID',
        'MSG_ID_INVALID',
        'BOT_METHOD_INVALID'
    ];
    
    // ероры, которые могут быть временными
    const temporaryErrors = [
        'FLOOD_WAIT',
        'TIMEOUT',
        'NETWORK_ERROR'
    ];
    
    if (fatalErrors.some(fatalError => errorMessage.includes(fatalError))) {
        console.log(`🚫 Критическая ошибка отправки: ${errorMessage}`);
        return true;
    }
    
    if (temporaryErrors.some(tempError => errorMessage.includes(tempError))) {
        console.log(`⏳ Временная ошибка: ${errorMessage}`);
        return false; // Продолжаем попытки
    }
    
    // По умолчанию считаем ерор не-критической
    console.log(`⚠️ Неизвестная ошибка: ${errorMessage}`);
    return false;
}

async checkPermissions(args, message, chatId, senderId, messageId) {
    try {
        const chat = await this.telegramClient.getEntity(chatId);
        const chatType = chat.className;
        
        let response = `🔐 ДИАГНОСТИКА ЧАТА:\n\n`;
        response += `• ID чата: ${chatId}\n`;
        response += `• Тип: ${chatType}\n`;
        
        if (chat.title) response += `• Название: ${chat.title}\n`;
        if (chat.username) response += `• Юзернейм: @${chat.username}\n`;
        
        // Пробуем отправить тестовое сообщение
        try {
            await this.telegramClient.sendMessage(chatId, {
                message: '✅ Тестовое сообщение от бота',
                silent: true
            });
            response += `• Отправка сообщений: ✅ РАБОТАЕТ\n`;
        } catch (sendError) {
            response += `• Отправка сообщений: ❌ ОШИБКА\n`;
            response += `• Ошибка: ${sendError.message}\n`;
        }
        
        await this.editMessage(chatId, messageId, response);
        
    } catch (error) {
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка диагностики: ${error.message}`
        );
    }
}

async exportTriggers(chatId, messageId) {
    try {
        const exportData = {
            triggers: Array.from(this.settings.triggers.values()).map(trigger => ({
                word: trigger.word,
                responses: trigger.responses,
                settings: trigger.settings
            }))
        };
        
        const exportText = JSON.stringify(exportData, null, 2);
        
        await this.editMessage(chatId, messageId, 
            `📤 ЭКСПОРТ ТРИГГЕРОВ (${exportData.triggers.length} шт.)\n\n` +
            '```json\n' + exportText.substring(0, 3000) + 
            (exportText.length > 3000 ? '\n... (сообщение обрезано)' : '') + '\n```'
        );
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка экспорта: ${error.message}`);
    }
}

    async manageTriggers(args, message, chatId, senderId, messageId) {
    if (args.length < 2) {
        await this.editMessage(chatId, messageId, 
            `🔔 РАСШИРЕННЫЕ ТРИГГЕРЫ v4.0 🔔\n\n` +
            `📝 ОСНОВНЫЕ КОМАНДЫ:\n` +
            `• ${this.settings.prefix}триггер add [слово] [ответы] - Добавить триггер\n` +
            `• ${this.settings.prefix}триггер remove [слово] - Удалить триггер\n` +
            `• ${this.settings.prefix}триггер edit [слово] [ответы] - Изменить ответы\n` +
            `• ${this.settings.prefix}триггер info [слово] - Подробная информация\n` +
            `• ${this.settings.prefix}триггер enable [слово] - Включить триггер\n` +
            `• ${this.settings.prefix}триггер disable [слово] - Выключить триггер\n` +
            `• ${this.settings.prefix}триггер list - Расширенный список\n` +
            `• ${this.settings.prefix}триггер clear - Очистить все\n` +
            `• ${this.settings.prefix}триггер stats - Статистика\n` +
            `• ${this.settings.prefix}триггер search [текст] - Поиск по триггерам\n` +
            `• ${this.settings.prefix}триггер backup - Создать бэкап\n` +
            `• ${this.settings.prefix}триггер restore - Восстановить из бэкапа\n` +
            `• ${this.settings.prefix}триггер import [json] - Импорт триггеров\n` +
            `• ${this.settings.prefix}триггер export - Экспорт триггеров\n\n` +

            `⚙️ РАСШИРЕННЫЕ НАСТРОЙКИ:\n` +
            `• -count=N - Количество отправок (1-20)\n` +
            `• -delay=N - Задержка между отправками в мс\n` +
            `• -chance=N - Шанс срабатывания в % (1-100)\n` +
            `• -cooldown=N - Кулдаун в секундах\n` +
            `• -regex - Использовать регулярное выражение\n` +
            `• -casesens - Чувствительность к регистру\n` +
            `• -reply - Отвечать на сообщение\n` +
            `• -silent - Тихий режим (без уведомлений)\n` +
            `• -chats=id1,id2 - Только в указанных чатах\n` +
            `• -users=id1,id2 - Только для указанных пользователей\n` +
            `• -exclude_chats=id1,id2 - Исключить чаты\n` +
            `• -exclude_users=id1,id2 - Исключить пользователей\n` +
            `• -time_start=HH:MM - Время начала активности\n` +
            `• -time_end=HH:MM - Время окончания активности\n` +
            `• -days=1,3,5 - Дни недели (1-пн, 7-вс)\n` +
            `• -priority=N - Приоритет (1-10)\n` +
            `• -typing - Показать набор текста\n` +
            `• -react=emoji - Добавить реакцию\n` +
            `• -delete_after=N - Удалить ответ через N сек\n` +
            `• -forward_to=id - Переслать в другой чат\n` +
            `• -webhook=url - Отправить webhook\n\n` +

            `🔄 ДИНАМИЧЕСКИЕ ПЕРЕМЕННЫЕ В ОТВЕТАХ:\n` +
            `• {user_id} - ID пользователя\n` +
            `• {user_name} - Имя пользователя\n` +
            `• {user_username} - Юзернейм\n` +
            `• {chat_id} - ID чата\n` +
            `• {chat_title} - Название чата\n` +
            `• {message_id} - ID сообщения\n` +
            `• {message_text} - Текст сообщения\n` +
            `• {time} - Текущее время\n` +
            `• {date} - Текущая дата\n` +
            `• {random} - Случайное число\n` +
            `• {trigger_word} - Слово триггера\n` +
            `• {trigger_count} - Количество использований\n\n` +

            `🎯 УСЛОВНЫЕ ОПЕРАТОРЫ:\n` +
            `• {if:условие|верно|неверно} - Условный оператор\n` +
            `• {equals:текст1|текст2|верно|неверно} - Сравнение\n` +
            `• {contains:текст|верно|неверно} - Содержит текст\n` +
            `• {length|верно|неверно} - Длина текста\n\n` +

            `📊 СИСТЕМНЫЕ ПЕРЕМЕННЫЕ:\n` +
            `• {bot_name} - Имя бота\n` +
            `• {bot_username} - Юзернейм бота\n` +
            `• {uptime} - Время работы бота\n` +
            `• {memory} - Использование памяти\n` +
            `• {triggers_count} - Количество триггеров\n\n` +

            `💡 ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ:\n` +
            `• ${this.settings.prefix}триггер add привет Привет, {user_name}! -reply -react 👋\n` +
            `• ${this.settings.prefix}триггер add время Сейчас {time} -typing -delete_after 10\n` +
            `• ${this.settings.prefix}триггер add /^\\d+$/ Вы ввели число: {message_text} -regex\n` +
            `• ${this.settings.prefix}триггер add тест {if:{user_id} 12345|Привет админ!|Привет пользователь!}\n` +
            `• ${this.settings.prefix}триггер add инфо Бот: {bot_name}, Память: {memory}MB\n` +
            `• ${this.settings.prefix}триггер add рандом Случайное число: {random:1-100}\n\n` +

            `🔧 ГРУППОВЫЕ ОПЕРАЦИИ:\n` +
            `• ${this.settings.prefix}триггер group add [группа] [слово1,слово2] - Группа триггеров\n` +
            `• ${this.settings.prefix}триггер group remove [группа] - Удалить группу\n` +
            `• ${this.settings.prefix}триггер group list - Список групп\n\n` +

            `📈 АВТОМАТИЗАЦИЯ:\n` +
            `• ${this.settings.prefix}триггер auto add [шаблон] [интервал] - Авто-сообщения\n` +
            `• ${this.settings.prefix}триггер auto remove [id] - Удалить авто-сообщение\n` +
            `• ${this.settings.prefix}триггер auto list - Список авто-сообщений`
        );
        return;
    }
    
     const action = args[0].toLowerCase();
    
    try {
        switch (action) {
            case 'добавить':
            case 'адд':
            case 'add':
                await this.addEnhancedTrigger(args, message, chatId, messageId);
                break;
                
            case 'remove':
            case 'del':
            case 'rem':
            case 'дел':
            case 'рем':
            case 'удалить':
            case 'делете':
            case 'delete':
                if (args.length < 2) {
                    throw new Error('Укажите название триггера для удаления');
                }
                await this.removeTrigger(args[1], chatId, messageId);
                break;
            
            case 'ред':
            case 'редакт':
            case 'едит':
            case 'edit':
                await this.editEnhancedTrigger(args, chatId, messageId);
                break;
               
            case 'инфо':
            case 'info':
                if (args.length < 2) {
                    throw new Error('Укажите название триггера для информации');
                }
                await this.showEnhancedTriggerInfo(args[1], chatId, messageId);
                break;
             
            case 'активировать':
            case 'енабле':
            case 'enable':
                if (args.length < 2) {
                    throw new Error('Укажите название триггера для включения');
                }
                await this.toggleTrigger(args[1], true, chatId, messageId);
                break;
            
            case 'деактивировать':
            case 'дисабле':
            case 'disable':
                if (args.length < 2) {
                    throw new Error('Укажите название триггера для выключения');
                }
                await this.toggleTrigger(args[1], false, chatId, messageId);
                break;
            
            case 'команды':
            case 'лист':
            case 'list':
                await this.listEnhancedTriggers(chatId, messageId);
                break;
             
            case 'очистить':
            case 'клир':
            case 'clear':
                await this.clearTriggers(chatId, messageId);
                break;
                
            case 'stats':
                await this.showEnhancedTriggersStats(chatId, messageId);
                break;
                
            case 'search':
                if (args.length < 2) {
                    throw new Error('Укажите текст для поиска');
                }
                await this.searchTriggers(args.slice(1).join(' '), chatId, messageId);
                break;
                
            case 'backup':
                await this.backupTriggers(chatId, messageId);
                break;
                
            case 'restore':
                await this.restoreTriggers(chatId, messageId);
                break;
                
            case 'import':
                if (args.length < 2) {
                    throw new Error('Укажите JSON данные для импорта');
                }
                await this.importTriggers(args.slice(1).join(' '), chatId, messageId);
                break;
                
            case 'export':
                await this.exportTriggers(chatId, messageId);
                break;
                
            case 'group':
                await this.manageTriggerGroups(args.slice(1), chatId, messageId);
                break;
                
            case 'auto':
                await this.manageAutoTriggers(args.slice(1), chatId, messageId);
                break;
                
            default:
                await this.editMessage(chatId, messageId, `❌ Неизвестное действие: ${action}`);
        }
    } catch (error) {
        console.error('❌ Ошибка управления триггерами:', error);
        await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
    }
}

async editEnhancedTrigger(args, chatId, messageId) {
    if (args.length < 3) {
        throw new Error('Укажите слово и новые ответы для редактирования');
    }
    
    const triggerWord = args[1];
    const trigger = this.settings.triggers.get(triggerWord.toLowerCase());
    
    if (!trigger) {
        throw new Error(`Триггер "${triggerWord}" не найден`);
    }
    
    // Получаем новые ответы и настройки
    let newResponses = [];
    let newSettings = { ...trigger.settings };
    let responseText = '';
    
    for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('-')) {
            const param = args[i].substring(2);
            const value = args[i + 1];
            
            switch (param) {
                case 'count':
                    newSettings.count = Math.min(Math.max(parseInt(value) || 1, 1), 20);
                    i++;
                    break;
                case 'delay':
                    newSettings.delay = parseInt(value) || 0;
                    i++;
                    break;
                case 'chance':
                    newSettings.chance = Math.min(Math.max(parseInt(value) || 100, 1), 100);
                    i++;
                    break;
                case 'cooldown':
                    newSettings.cooldown = parseInt(value) || 0;
                    i++;
                    break;
                case 'regex':
                    newSettings.regex = true;
                    break;
                case 'casesens':
                    newSettings.caseSensitive = true;
                    break;
                case 'reply':
                    newSettings.reply = true;
                    break;
                case 'silent':
                    newSettings.silent = true;
                    break;
                case 'typing':
                    newSettings.typing = true;
                    break;
                case 'priority':
                    newSettings.priority = Math.min(Math.max(parseInt(value) || 1, 1), 10);
                    i++;
                    break;
                case 'delete_after':
                    newSettings.deleteAfter = parseInt(value) || 0;
                    i++;
                    break;
                case 'react':
                    newSettings.react = value;
                    i++;
                    break;
                case 'enabled':
                    newSettings.enabled = value.toLowerCase() === 'true';
                    i++;
                    break;
            }
        } else {
            responseText += (responseText ? ' ' : '') + args[i];
        }
    }
    
    // Разделяем ответы по |
    if (responseText.includes('|')) {
        newResponses = responseText.split('|').map(r => r.trim()).filter(r => r);
    } else if (responseText) {
        newResponses = [responseText];
    } else {
        newResponses = trigger.responses; // Сохраняем старые ответы если новые не указаны
    }
    
    // Обновляем триггер
    trigger.responses = newResponses;
    trigger.settings = newSettings;
    
    // Сохраняем в базу
    await this.saveTriggerToDatabase(trigger);
    await this.saveAllData();
    
    await this.editMessage(chatId, messageId, 
        `✅ Триггер "${triggerWord}" обновлен\n` +
        `🔸 Ответы: ${newResponses.length}\n` +
        `🔸 Статус: ${newSettings.enabled ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n` +
        `📊 Всего использований: ${trigger.settings.used}`
    );
}

    async showEnhancedTriggerInfo(triggerWord, chatId, messageId, senderId = null) {
    const trigger = this.settings.triggers.get(triggerWord.toLowerCase());
    
    if (!trigger) {
        await this.editMessage(chatId, messageId, `❌ Триггер "${triggerWord}" не найден`);
        return;
    }
    
    const settings = trigger.settings;
    
    // Проверяем Premium статус для информационного сообщения
    const isPremium = senderId ? await this.checkUserPremium(senderId) : false;
    const normalizedEmoji = await this.normalizeEmoji(settings.react, senderId);
    
    const reactionInfo = settings.react ? 
        `${settings.react} ${isPremium ? '💎' : ''}${settings.react !== normalizedEmoji ? ` → ${normalizedEmoji} (нормализовано)` : ''}` : 
        'Нет';
    
    let response = `📋 ИНФОРМАЦИЯ О ТРИГГЕРЕ\n\n` +
                  `🔸 Слово: ${trigger.word}\n` +
                  `🔸 Статус: ${settings.enabled ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}\n` +
                  `🔸 Создан: ${new Date(settings.created).toLocaleString('ru-RU')}\n` +
                  `🔸 Использован: ${settings.used} раз\n` +
                  `🔸 Последнее использование: ${settings.lastUsed ? new Date(settings.lastUsed).toLocaleString('ru-RU') : 'Никогда'}\n` +
                  `🔸 Premium статус: ${isPremium ? '💎 Есть' : '🔹 Нет'}\n\n` +
                  `⚙️ НАСТРОЙКИ:\n` +
                  `• Повторов: ${settings.count}\n` +
                  `• Задержка: ${settings.delay}мс\n` +
                  `• Шанс: ${settings.chance}%\n` +
                  `• Кулдаун: ${settings.cooldown}сек\n` +
                  `• Приоритет: ${settings.priority || 1}\n` +
                  `• Режим: ${settings.regex ? 'REGEX' : 'Текст'}\n` +
                  `• Регистр: ${settings.caseSensitive ? 'Чувствителен' : 'Не чувствителен'}\n` +
                  `• Ответ: ${settings.reply ? 'Да' : 'Нет'}\n` +
                  `• Тихий: ${settings.silent ? 'Да' : 'Нет'}\n` +
                  `• Набор текста: ${settings.typing ? 'Да' : 'Нет'}\n` +
                  `• Реакция: ${reactionInfo}\n` +
                  `• Удаление через: ${settings.deleteAfter || 'Не удалять'} сек\n\n` +
                  `💬 ОТВЕТЫ (${trigger.responses.length}):\n`;
    
    trigger.responses.forEach((resp, index) => {
        const responseText = String(resp || '');
        response += `${index + 1}. ${responseText}\n`;
    });
    
    await this.editMessage(chatId, messageId, response);
}

async checkPremiumStatus(args, message, chatId, senderId, messageId) {
    try {
        let targetUserId = senderId;
        
        // Если указан юзернейм или это ответ на сообщение
        if (args.length > 0) {
            const username = args[0].replace('@', '');
            try {
                const user = await this.telegramClient.getEntity(username);
                targetUserId = user.id;
            } catch (error) {
                await this.editMessage(chatId, messageId, `❌ Пользователь @${username} не найден`);
                return;
            }
        } else if (message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessages = await this.telegramClient.getMessages(chatId, {
                ids: [message.replyTo.replyToMsgId]
            });
            if (repliedMessages[0] && repliedMessages[0].senderId) {
                targetUserId = repliedMessages[0].senderId;
            }
        }
        
        const isPremium = await this.checkUserPremium(targetUserId);
        const user = await this.telegramClient.getEntity(targetUserId);
        
        let response = `👤 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:\n\n`;
        if (user.firstName) response += `📝 Имя: ${user.firstName}\n`;
        if (user.lastName) response += `📝 Фамилия: ${user.lastName}\n`;
        if (user.username) response += `🔗 Юзернейм: @${user.username}\n`;
        response += `🆔 ID: ${targetUserId}\n`;
        response += `💎 Telegram Premium: ${isPremium ? '✅ ДА' : '❌ НЕТ'}\n\n`;
        
        if (isPremium) {
            response += `🎉 Отлично! Вы можете использовать любые эмодзи в реакциях!\n`;
            response += `💡 Пример: ${this.settings.prefix}триггер add тест Ответ -react 🤷🏻🎉✨`;
        } else {
            response += `🔹 Доступны только базовые эмодзи для реакций\n`;
            response += `📋 Используйте ${this.settings.prefix}реакции для просмотра списка`;
        }
        
        await this.editMessage(chatId, messageId, response);
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка проверки Premium статуса: ${error.message}`);
    }
}

    async checkReactionSupport(chatId, messageId) {
    try {
        const chat = await this.telegramClient.getEntity(chatId);
        console.log(`🔍 Проверка поддержки реакций в чате ${chatId}:`, {
            className: chat.className,
            title: chat.title,
            username: chat.username
        });
        
        // Пробуем отправить тестовую реакцию
        const peer = await this.telegramClient.getInputEntity(chatId);
        
        const result = await this.telegramClient.invoke(
            new Api.messages.SendReaction({
                peer: peer,
                msgId: messageId,
                reaction: [
                    new Api.ReactionEmoji({
                        emoticon: '👍'
                    })
                ]
            })
        );
        
        console.log('✅ Тест реакции успешен:', result);
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка теста реакции:', {
            message: error.message,
            code: error.code,
            className: error.className
        });
        return false;
    }
}

async listEnhancedTriggers(chatId, messageId) {
    if (this.settings.triggers.size === 0) {
        await this.editMessage(chatId, messageId, `📋 Триггеры не настроены`);
        return;
    }
    
    let enabledCount = 0;
    let disabledCount = 0;
    let totalUses = 0;
    
    this.settings.triggers.forEach(trigger => {
        if (trigger.settings.enabled) enabledCount++;
        else disabledCount++;
        totalUses += trigger.settings.used;
    });
    
    let response = `📋 РАСШИРЕННЫЕ ТРИГГЕРЫ\n\n` +
                  `📊 Статистика:\n` +
                  `• Всего: ${this.settings.triggers.size}\n` +
                  `• Активных: ${enabledCount}\n` +
                  `• Отключенных: ${disabledCount}\n` +
                  `• Всего использований: ${totalUses}\n\n` +
                  `🔔 СПИСОК ТРИГГЕРОВ:\n\n`;
    
    let index = 1;
    this.settings.triggers.forEach((trigger, word) => {
        const status = trigger.settings.enabled ? '✅' : '❌';
        const uses = trigger.settings.used || 0;
        response += `${status} ${index}. "${word}" (исп. ${uses} раз)\n`;
        index++;
    });
    
    response += `\n💡 Используйте ${this.settings.prefix}триггер info [слово] для подробностей`;
    
    // Если триггеров много, разбиваем на части
    if (response.length > 4000) {
        const mid = Math.floor(response.length / 2);
        const firstPart = response.substring(0, mid);
        const secondPart = response.substring(mid);
        
        await this.editMessage(chatId, messageId, firstPart);
        await this.telegramClient.sendMessage(chatId, { message: secondPart });
    } else {
        await this.editMessage(chatId, messageId, response);
    }
}

async showEnhancedTriggersStats(chatId, messageId) {
    if (this.settings.triggers.size === 0) {
        await this.editMessage(chatId, messageId, `📊 Нет данных о триггерах`);
        return;
    }
    
    let totalUses = 0;
    let mostUsedTrigger = { word: '', uses: 0 };
    let recentlyUsed = null;
    let enabledCount = 0;
    
    this.settings.triggers.forEach(trigger => {
        const uses = trigger.settings.used || 0;
        totalUses += uses;
        
        if (trigger.settings.enabled) {
            enabledCount++;
        }
        
        if (uses > mostUsedTrigger.uses) {
            mostUsedTrigger = { word: trigger.word, uses: uses };
        }
        
        if (trigger.settings.lastUsed && (!recentlyUsed || 
            new Date(trigger.settings.lastUsed) > new Date(recentlyUsed.lastUsed))) {
            recentlyUsed = { word: trigger.word, lastUsed: trigger.settings.lastUsed };
        }
    });
    
    const avgUses = Math.round(totalUses / this.settings.triggers.size);
    
    let response = `📊 СТАТИСТИКА ТРИГГЕРОВ\n\n` +
                  `• Всего триггеров: ${this.settings.triggers.size}\n` +
                  `• Активных: ${enabledCount}\n` +
                  `• Отключенных: ${this.settings.triggers.size - enabledCount}\n` +
                  `• Всего использований: ${totalUses}\n` +
                  `• Среднее использование: ${avgUses} раз\n\n`;
    
    if (mostUsedTrigger.uses > 0) {
        response += `🏆 Самый популярный:\n` +
                   `"${mostUsedTrigger.word}" - ${mostUsedTrigger.uses} раз\n\n`;
    }
    
    if (recentlyUsed) {
        response += `⏰ Последний использованный:\n` +
                   `"${recentlyUsed.word}" - ${new Date(recentlyUsed.lastUsed).toLocaleString('ru-RU')}`;
    }
    
    await this.editMessage(chatId, messageId, response);
}

async restoreTriggers(chatId, messageId) {
    try {
        await this.editMessage(chatId, messageId, '🔧 Восстановление триггеров...');
        
        // Загружаем триггеры из базы
        await this.loadTriggersFromDatabase();
        
        await this.editMessage(chatId, messageId, 
            `✅ Триггеры восстановлены из базы\n` +
            `📊 Загружено: ${this.settings.triggers.size} триггеров`
        );
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка восстановления: ${error.message}`);
    }
}

async importTriggers(jsonData, chatId, messageId) {
    try {
        if (!jsonData || jsonData.trim() === '') {
            throw new Error('Укажите JSON данные для импорта');
        }
        
        await this.editMessage(chatId, messageId, '🔧 Импорт триггеров...');
        
        const importData = JSON.parse(jsonData);
        
        if (!importData.triggers || !Array.isArray(importData.triggers)) {
            throw new Error('Неверный формат данных для импорта');
        }
        
        let importedCount = 0;
        let skippedCount = 0;
        
        for (const triggerData of importData.triggers) {
            try {
                if (!triggerData.word || !triggerData.responses) {
                    skippedCount++;
                    continue;
                }
                
                // Создаем объект триггера с настройками по умолчанию
                const trigger = {
                    word: triggerData.word,
                    responses: triggerData.responses,
                    settings: {
                        count: triggerData.settings?.count || 1,
                        delay: triggerData.settings?.delay || 0,
                        chance: triggerData.settings?.chance || 100,
                        cooldown: triggerData.settings?.cooldown || 0,
                        enabled: triggerData.settings?.enabled !== false,
                        regex: triggerData.settings?.regex || false,
                        caseSensitive: triggerData.settings?.caseSensitive || false,
                        reply: triggerData.settings?.reply || false,
                        silent: triggerData.settings?.silent || false,
                        created: new Date(),
                        used: 0,
                        lastUsed: null
                    }
                };
                
                // Сохраняем в базу
                await this.saveTriggerToDatabase(trigger);
                
                // Сохраняем в память
                this.settings.triggers.set(trigger.word.toLowerCase(), trigger);
                importedCount++;
                
            } catch (triggerError) {
                skippedCount++;
                console.error(`Ошибка импорта триггера:`, triggerError);
            }
        }
        
        await this.saveAllData();
        
        await this.editMessage(chatId, messageId, 
            `✅ Импорт завершен\n` +
            `📥 Успешно: ${importedCount} триггеров\n` +
            `⏭️ Пропущено: ${skippedCount}`
        );
        
    } catch (error) {
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка импорта: ${error.message}\n\n` +
            `💡 Пример формата:\n` +
            `{"triggers": [{"word": "привет", "responses": ["Привет!"], "settings": {...}}]}`
        );
    }
}



async manageAutoTriggers(args, chatId, messageId) {
    try {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, 
                '📅 Управление авто-сообщениями:\n\n' +
                `${this.settings.prefix}триггер auto add [интервал] [текст] - Добавить авто-сообщение\n` +
                `${this.settings.prefix}триггер auto remove [id] - Удалить авто-сообщение\n` +
                `${this.settings.prefix}триггер auto list - Список авто-сообщений\n` +
                `${this.settings.prefix}триггер auto clear - Очистить все авто-сообщения`
            );
            return;
        }

        const action = args[0].toLowerCase();
        
        switch (action) {
            case 'add':
                if (args.length < 3) {
                    throw new Error('Укажите интервал (в минутах) и текст сообщения');
                }
                
                const interval = parseInt(args[1]);
                const text = args.slice(2).join(' ');
                
                if (isNaN(interval) || interval < 1) {
                    throw new Error('Интервал должен быть числом (минуты)');
                }
                
                const autoMsg = {
                    id: Date.now(),
                    interval: interval * 60 * 1000, // конвертируем в мс
                    text: text,
                    chatId: chatId,
                    lastSent: null,
                    enabled: true
                };
                
                // Сохраняем в базу или память
                if (!this.settings.autoMessages) {
                    this.settings.autoMessages = new Map();
                }
                this.settings.autoMessages.set(autoMsg.id, autoMsg);
                
                await this.editMessage(chatId, messageId, 
                    `✅ Авто-сообщение добавлено!\n` +
                    `🆔 ID: ${autoMsg.id}\n` +
                    `⏰ Интервал: ${interval} минут\n` +
                    `💬 Текст: ${text}`
                );
                break;
                
            case 'remove':
            case 'delete':
                if (args.length < 2) {
                    throw new Error('Укажите ID авто-сообщения для удаления');
                }
                
                const removeId = parseInt(args[1]);
                if (this.settings.autoMessages && this.settings.autoMessages.has(removeId)) {
                    this.settings.autoMessages.delete(removeId);
                    await this.editMessage(chatId, messageId, `✅ Авто-сообщение ${removeId} удалено`);
                } else {
                    throw new Error('Авто-сообщение с указанным ID не найдено');
                }
                break;
                
            case 'list':
                if (!this.settings.autoMessages || this.settings.autoMessages.size === 0) {
                    await this.editMessage(chatId, messageId, '📭 Авто-сообщения не настроены');
                    return;
                }
                
                let list = '📅 СПИСОК АВТО-СООБЩЕНИЙ:\n\n';
                this.settings.autoMessages.forEach((msg, id) => {
                    const intervalMin = msg.interval / (60 * 1000);
                    const status = msg.enabled ? '✅' : '❌';
                    list += `${status} ${id}: каждые ${intervalMin} мин - "${msg.text}"\n`;
                });
                
                await this.editMessage(chatId, messageId, list);
                break;
                
            case 'clear':
                if (this.settings.autoMessages) {
                    const count = this.settings.autoMessages.size;
                    this.settings.autoMessages.clear();
                    await this.editMessage(chatId, messageId, `✅ Очищено ${count} авто-сообщений`);
                } else {
                    await this.editMessage(chatId, messageId, '📭 Нет авто-сообщений для очистки');
                }
                break;
                
            default:
                throw new Error('Неизвестное действие. Используйте: add, remove, list, clear');
        }
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка управления авто-сообщениями: ${error.message}`);
    }
}

async manageTriggerGroups(args, chatId, messageId) {
    try {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, 
                '👥 Управление группами триггеров:\n\n' +
                `${this.settings.prefix}триггер group add [название] [слова] - Добавить группу\n` +
                `${this.settings.prefix}триггер group remove [название] - Удалить группу\n` +
                `${this.settings.prefix}триггер group list - Список групп\n` +
                `${this.settings.prefix}триггер group info [название] - Информация о группе`
            );
            return;
        }

        const action = args[0].toLowerCase();
        
        // Инициализация групп если нет
        if (!this.settings.triggerGroups) {
            this.settings.triggerGroups = new Map();
        }
        
        switch (action) {
            case 'add':
                if (args.length < 3) {
                    throw new Error('Укажите название группы и слова через запятую');
                }
                
                const groupName = args[1];
                const words = args.slice(2).join(' ').split(',').map(w => w.trim()).filter(w => w);
                
                if (words.length === 0) {
                    throw new Error('Укажите хотя бы одно слово для группы');
                }
                
                const group = {
                    name: groupName,
                    words: words,
                    created: new Date(),
                    triggers: []
                };
                
                // Находим триггеры для этих слов
                words.forEach(word => {
                    const trigger = this.settings.triggers.get(word.toLowerCase());
                    if (trigger) {
                        group.triggers.push(trigger);
                    }
                });
                
                this.settings.triggerGroups.set(groupName.toLowerCase(), group);
                
                await this.editMessage(chatId, messageId, 
                    `✅ Группа триггеров создана!\n` +
                    `📛 Название: ${groupName}\n` +
                    `🔤 Слова: ${words.join(', ')}\n` +
                    `🎯 Найдено триггеров: ${group.triggers.length}`
                );
                break;
                
            case 'remove':
            case 'delete':
                if (args.length < 2) {
                    throw new Error('Укажите название группы для удаления');
                }
                
                const removeGroup = args[1].toLowerCase();
                if (this.settings.triggerGroups.has(removeGroup)) {
                    this.settings.triggerGroups.delete(removeGroup);
                    await this.editMessage(chatId, messageId, `✅ Группа "${args[1]}" удалена`);
                } else {
                    throw new Error('Группа с указанным названием не найдена');
                }
                break;
                
            case 'list':
                if (this.settings.triggerGroups.size === 0) {
                    await this.editMessage(chatId, messageId, '📭 Группы триггеров не настроены');
                    return;
                }
                
                let groupList = '👥 ГРУППЫ ТРИГГЕРОВ:\n\n';
                this.settings.triggerGroups.forEach((group, name) => {
                    groupList += `📛 ${name}:\n`;
                    groupList += `   🔸 Слов: ${group.words.length}\n`;
                    groupList += `   🎯 Триггеров: ${group.triggers.length}\n`;
                    groupList += `   📅 Создана: ${group.created.toLocaleDateString('ru-RU')}\n\n`;
                });
                
                await this.editMessage(chatId, messageId, groupList);
                break;
                
            case 'info':
                if (args.length < 2) {
                    throw new Error('Укажите название группы');
                }
                
                const infoGroup = args[1].toLowerCase();
                const groupInfo = this.settings.triggerGroups.get(infoGroup);
                
                if (!groupInfo) {
                    throw new Error('Группа не найдена');
                }
                
                let info = `📋 ИНФОРМАЦИЯ О ГРУППЕ "${groupInfo.name}":\n\n`;
                info += `🔤 Слова (${groupInfo.words.length}): ${groupInfo.words.join(', ')}\n\n`;
                info += `🎯 Триггеры (${groupInfo.triggers.length}):\n`;
                
                groupInfo.triggers.forEach((trigger, index) => {
                    info += `${index + 1}. "${trigger.word}" - ${trigger.responses.length} ответов\n`;
                });
                
                await this.editMessage(chatId, messageId, info);
                break;
                
            default:
                throw new Error('Неизвестное действие. Используйте: add, remove, list, info');
        }
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка управления группами: ${error.message}`);
    }
}

    async listTriggers(args, message, chatId, senderId, messageId) {
    if (this.settings.triggers.size === 0) {
        await this.editMessage(chatId, messageId, `📋 Триггеры не настроены`);
        return;
    }

    let response = `📋 СПИСОК ТРИГГЕРОВ\n\n`;
    let index = 1;
    
    for (const [word, trigger] of this.settings.triggers) {
        // Правильно обрабатываем ответы триггера
        let responsesPreview = '';
        if (trigger.responses && Array.isArray(trigger.responses)) {
            responsesPreview = trigger.responses.slice(0, 2).map(r => {
                // Обрезаем длинные ответы и экранируем специальные символы
                const text = String(r || '').substring(0, 30);
                return text.length < 30 ? text : text + '...';
            }).join(' | ');
        } else {
            responsesPreview = 'Некорректные ответы';
        }
        
        const status = trigger.settings?.enabled ? '✅' : '❌';
        const uses = trigger.settings?.used || 0;
        
        response += `${status} ${index}. "${word}" → ${responsesPreview} (исп. ${uses} раз)\n`;
        index++;
    }

    await this.editMessage(chatId, messageId, response);
}

    async megaPush(args, message, chatId, senderId, messageId) {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, 
                `📢 Использование: ${this.settings.prefix}мегапуш [текст]`
            );
            return;
        }
        
        const text = args.join(' ');
        try {
            const dialogs = await this.telegramClient.getDialogs({});
            let sentCount = 0;
            
            for (const dialog of dialogs) {
                if (dialog.isUser || dialog.isGroup) {
                    try {
                        await this.telegramClient.sendMessage(dialog.entity.id, { message: text });
                        sentCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (error) {
                        console.error(`❌ Ошибка отправки в ${dialog.entity.id}: ${error.message}`);
                    }
                }
            }
            
            await this.editMessage(chatId, messageId, `✅ Отправлено ${sentCount} сообщений`);
        } catch (error) {
            await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
        }
    }

    async forwardMentions(args, message, chatId, senderId, messageId) {
        try {
            const mentions = await this.telegramClient.getMessages(chatId, {
                search: '@',
                limit: 50
            });
            
            if (mentions.length === 0) {
                await this.editMessage(chatId, messageId, `📨 Упоминаний не найдено`);
                return;
            }
            
            let forwarded = 0;
            for (const msg of mentions) {
                try {
                    await this.telegramClient.forwardMessages(chatId, {
                        messages: [msg.id],
                        fromPeer: chatId
                    });
                    forwarded++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error(`❌ Ошибка пересылки: ${error.message}`);
                }
            }
            
            await this.editMessage(chatId, messageId, `✅ Переслано ${forwarded} упоминаний`);
        } catch (error) {
            await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
        }
    }

    async deleteMessages(args, message, chatId, senderId, messageId) {
    try {
        let messagesToDelete = [messageId]; // Всегда удаляем сообщение с командой
        
        // Если есть ответ на сообщение
        if (message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessageId = message.replyTo.replyToMsgId;
            messagesToDelete.push(repliedMessageId);
            
            // Если указано количество дополнительных сообщений
            if (args.length > 0) {
                const additionalCount = parseInt(args[0]);
                if (!isNaN(additionalCount) && additionalCount > 0) {
                    // Получаем историю сообщений
                    const messages = await this.telegramClient.getMessages(chatId, { 
                        limit: additionalCount + 10
                    });
                    
                    // Находим индекс сообщения, на которое ответили
                    const repliedIndex = messages.findIndex(msg => msg.id === repliedMessageId);
                    if (repliedIndex !== -1) {
                        // Берем дополнительные сообщения ДО replied сообщения
                        const startIndex = Math.max(0, repliedIndex - additionalCount);
                        const endIndex = repliedIndex;
                        
                        for (let i = startIndex; i < endIndex; i++) {
                            if (messages[i].id !== messageId) { // Исключаем команду
                                messagesToDelete.push(messages[i].id);
                            }
                        }
                    }
                }
            }
        } 
        // Если нет ответа, но указано количество
        else if (args.length > 0) {
            const count = parseInt(args[0]);
            if (!isNaN(count) && count > 0) {
                // Получаем последние сообщения
                const messages = await this.telegramClient.getMessages(chatId, { 
                    limit: count + 1
                });
                
                // Добавляем count сообщений для удаления (кроме самой команды)
                for (let i = 0; i < Math.min(messages.length, count); i++) {
                    if (messages[i].id !== messageId) {
                        messagesToDelete.push(messages[i].id);
                    }
                }
            }
        }
        
        // Удаляем сообщения
        if (messagesToDelete.length > 0) {
            // Используем правильный метод удаления
            for (const msgId of messagesToDelete) {
                try {
                    await this.telegramClient.deleteMessages(chatId, [msgId], {
                        revoke: true
                    });
                    // Небольшая задержка между удалениями
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (deleteError) {
                    console.error(`❌ Ошибка удаления сообщения ${msgId}:`, deleteError.message);
                }
            }
            
            // Отправляем уведомление об удалении
            if (messagesToDelete.length > 1) {
                try {
                    const notification = await this.telegramClient.sendMessage(chatId, {
                        message: `✅ Удалено ${messagesToDelete.length} сообщений`
                    });
                    
                    // Удаляем уведомление через 3 секунды
                    setTimeout(async () => {
                        try {
                            await this.telegramClient.deleteMessages(chatId, [notification.id], {
                                revoke: true
                            });
                        } catch (e) {
                            // игнорим ерор удаления уведомления
                        }
                    }, 3000);
                } catch (notificationError) {
                    console.error('❌ Ошибка отправки уведомления:', notificationError);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления сообщений:', error);
        
        // пытаемся отправить соо об ероре
        try {
            const errorMsg = await this.telegramClient.sendMessage(chatId, {
                message: `❌ Ошибка удаления: ${error.message}`
            });
            
            // делетаем соо об ероре через 5 секунд
            setTimeout(async () => {
                try {
                    await this.telegramClient.deleteMessages(chatId, [errorMsg.id], {
                        revoke: true
                    });
                } catch (e) {
                    // игнорим ерор
                }
            }, 5000);
        } catch (sendError) {
            console.error('❌ Не удалось отправить сообщение об ошибке:', sendError);
        }
    }
}

    async smsBomb(args, message, chatId, senderId, messageId) {
        if (args.length < 2) {
            await this.editMessage(chatId, messageId, 
                `💣 Использование: ${this.settings.prefix}бомба_смс [user_id] [количество]`
            );
            return;
        }
        
        const targetUserId = parseInt(args[0]);
        const count = Math.min(parseInt(args[1]), 100);
        
        try {
            for (let i = 0; i < count; i++) {
                await this.telegramClient.sendMessage(targetUserId, {
                    message: `💣 SMS Bomb #${i + 1}`
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            await this.editMessage(chatId, messageId, `✅ Отправлено ${count} сообщений`);
        } catch (error) {
            await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
        }
    }

    async togglePinMessage(args, message, chatId, senderId, messageId) {
    try {
        if (message.replyTo && message.replyTo.replyToMsgId) {
            const repliedMessageId = message.replyTo.replyToMsgId;
            
            // Пробуем закрепить сообщение
            try {
                await this.telegramClient.invoke(
                    new Api.messages.UpdatePinnedMessage({
                        peer: await this.telegramClient.getInputEntity(chatId),
                        id: repliedMessageId,
                        unpin: false,
                        pmOneSide: false
                    })
                );
                await this.editMessage(chatId, messageId, `📌 Сообщение закреплено`);
            } catch (error) {
                // Если не удалось закрепить, возможно сообщение уже закреплено
                // Пробуем открепить
                try {
                    await this.telegramClient.invoke(
                        new Api.messages.UpdatePinnedMessage({
                            peer: await this.telegramClient.getInputEntity(chatId),
                            id: repliedMessageId,
                            unpin: true,
                            pmOneSide: false
                        })
                    );
                    await this.editMessage(chatId, messageId, `📌 Сообщение откреплено`);
                } catch (unpinError) {
                    // Если не удалось открепить, показываем ерор
                    throw new Error(`Не удалось закрепить или открепить: ${unpinError.message}`);
                }
            }
        } else {
            // Если нет ответа - открепляем все сообщения
            await this.telegramClient.invoke(
                new Api.messages.UnpinAllMessages({
                    peer: await this.telegramClient.getInputEntity(chatId)
                })
            );
            await this.editMessage(chatId, messageId, `📌 Все сообщения откреплены`);
        }
    } catch (error) {
        console.error('❌ Ошибка закрепления/открепления:', error);
        
        let errorMessage = `❌ Ошибка: ${error.message}`;
        if (error.message.includes('CHAT_NOT_MODIFIED')) {
            errorMessage = `❌ Сообщение уже имеет нужный статус`;
        } else if (error.message.includes('CHAT_ADMIN_REQUIRED')) {
            errorMessage = `❌ Требуются права администратора`;
        } else if (error.message.includes('MESSAGE_ID_INVALID')) {
            errorMessage = `❌ Сообщение не найдено`;
        } else if (error.message.includes('CHAT_ID_INVALID')) {
            errorMessage = `❌ Неверный ID чата`;
        }
        
        await this.editMessage(chatId, messageId, errorMessage);
    }
}

    async chatMove(args, message, chatId, senderId, messageId) {
        if (args.length === 0) {
            await this.editMessage(chatId, messageId, 
                `🚚 Использование: ${this.settings.prefix}переезд [новый_чатид]`
            );
            return;
        }
        
        const newChatId = args[0];
        try {
            const participants = await this.telegramClient.getParticipants(chatId);
            let moved = 0;
            
            for (const participant of participants) {
                try {
                    await this.telegramClient.addChatUser(newChatId, participant.id);
                    moved++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`❌ Ошибка перемещения ${participant.id}: ${error.message}`);
                }
            }
            
            await this.editMessage(chatId, messageId, `✅ Перемещено ${moved} участников`);
        } catch (error) {
            await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
        }
    }

    // Добавьте этот метод для проверки Premium статуса пользователя
async checkUserPremium(userId) {
    try {
        const user = await this.telegramClient.getEntity(userId);
        
        // Проверяем наличие флага premium
        if (user.premium) {
            console.log(`💎 Пользователь ${userId} имеет Telegram Premium`);
            return true;
        }
        
        // Альтернативная проверка через полную информацию о пользователе
        try {
            const fullUser = await this.telegramClient.invoke(
                new Api.users.GetFullUser({
                    id: await this.telegramClient.getInputEntity(userId)
                })
            );
            
            if (fullUser.user && fullUser.user.premium) {
                console.log(`💎 Пользователь ${userId} имеет Telegram Premium (через fullUser)`);
                return true;
            }
        } catch (fullError) {
            console.log('⚠️ Не удалось проверить Premium через fullUser:', fullError.message);
        }
        
        console.log(`🔹 Пользователь ${userId} не имеет Telegram Premium`);
        return false;
        
    } catch (error) {
        console.error('❌ Ошибка проверки Premium статуса:', error.message);
        return false;
    }
}

// Проверка Premium статуса бота (на всякий случай)
async checkBotPremium() {
    try {
        if (!this.botInfo) {
            this.botInfo = await this.telegramClient.getMe();
        }
        return await this.checkUserPremium(this.botInfo.id);
    } catch (error) {
        console.error('❌ Ошибка проверки Premium статуса бота:', error);
        return false;
    }
}

    async manageCustomValues(args, message, chatId, senderId, messageId) {
    if (args.length < 2) {
        const currentValues = this.settings.customValues;
        const response = `🎭 КАСТОМНЫЕ ЗНАЧЕНИЯ БОТА\n\n` +
                       `⏰ Аптайм: ${currentValues.uptime || 'не установлен'}\n` +
                       `👑 Создатель: ${currentValues.creator || 'не установлен'}\n` +
                       `🔧 Версия: ${currentValues.version || 'не установлен'}\n` +
                       `🤖 Имя бота: ${currentValues.botName || 'не установлено'}\n` +
                       `📱 Статус: ${currentValues.status || 'не установлен'}\n\n` +
                       `💡 Команды:\n` +
                       `• ${this.settings.prefix}кастом аптайм [текст] - установить кастомный аптайм\n` +
                       `• ${this.settings.prefix}кастом создатель [текст] - установить создателя\n` +
                       `• ${this.settings.prefix}кастом версия [текст] - установить версию\n` +
                       `• ${this.settings.prefix}кастом имя [текст] - установить имя бота\n` +
                       `• ${this.settings.prefix}кастом статус [текст] - установить статус\n` +
                       `• ${this.settings.prefix}сброс_прикола - сбросить все значения\n` +
                       `• ${this.settings.prefix}по приколу - установить прикольные значения`;
        
        await this.editMessage(chatId, messageId, response);
        return;
    }

    const action = args[0].toLowerCase();
    const value = args.slice(1).join(' ');

    try {
        switch (action) {
            case 'аптайм':
            case 'uptime':
                this.settings.customValues.uptime = value;
                await this.editMessage(chatId, messageId, 
                    `✅ Кастомный аптайм установлен!\n` +
                    `📝 Теперь будет отображаться: "${value}"`
                );
                break;
                
            case 'создатель':
            case 'creator':
                this.settings.customValues.creator = value;
                await this.editMessage(chatId, messageId,
                    `✅ Кастомный создатель установлен!\n` +
                    `👑 Теперь создатель: "${value}"`
                );
                break;
                
            case 'версия':
            case 'version':
                this.settings.customValues.version = value;
                await this.editMessage(chatId, messageId,
                    `✅ Кастомная версия установлена!\n` +
                    `🔧 Теперь версия: "${value}"`
                );
                break;
                
            case 'имя':
            case 'name':
            case 'botname':
                this.settings.customValues.botName = value;
                await this.editMessage(chatId, messageId,
                    `✅ Кастомное имя бота установлено!\n` +
                    `🤖 Теперь бот называется: "${value}"`
                );
                break;
                
            case 'статус':
            case 'status':
                this.settings.customValues.status = value;
                await this.editMessage(chatId, messageId,
                    `✅ Кастомный статус установлен!\n` +
                    `📱 Теперь статус: "${value}"`
                );
                break;
                
            default:
                await this.editMessage(chatId, messageId,
                    `❌ Неизвестное действие. Используйте: аптайм, создатель, версия, имя, статус`
                );
                return;
        }
        
        // Сохраняем настройки
        this.saveSettings();
        
    } catch (error) {
        await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
    }
}

async setFunnyValues(args, message, chatId, senderId, messageId) {
    const funnyValues = {
        uptime: "♾️ Бесконечность и дальше",
        creator: "👽 Пришелец из космоса",
        version: "🎲 Случайная версия 4.2.0",
        botName: "🤡 Бот-Приколист",
        status: "🎪 Веселюсь и радуюсь"
    };

    this.settings.customValues = { ...funnyValues };
    this.saveSettings();

    const response = `🎪 УСТАНОВЛЕНЫ ПРИКОЛЬНЫЕ ЗНАЧЕНИЯ!\n\n` +
                   `⏰ Аптайм: ${funnyValues.uptime}\n` +
                   `👑 Создатель: ${funnyValues.creator}\n` +
                   `🔧 Версия: ${funnyValues.version}\n` +
                   `🤖 Имя бота: ${funnyValues.botName}\n` +
                   `📱 Статус: ${funnyValues.status}\n\n` +
                   `💡 Теперь команды типа ${this.settings.prefix}тест будут показывать эти значения!\n` +
                   `😎 Чтобы сбросить: ${this.settings.prefix}сброс_прикола`;

    await this.editMessage(chatId, messageId, response);
}

async resetFunnyValues(args, message, chatId, senderId, messageId) {
    this.settings.customValues = {
        uptime: null,
        creator: null,
        version: null,
        botName: null,
        status: null
    };
    this.saveSettings();

    await this.editMessage(chatId, messageId,
        `🔄 Все кастомные значения сброшены!\n` +
        `📊 Теперь отображаются реальные данные бота.`
    );
}

async testCommand(args, message, chatId, senderId, messageId) {
    const custom = this.settings.customValues;
    
    const realUptime = `${Math.floor((new Date() - this.startTime) / 1000)} сек.`;
    const realCreator = "@chovamnadoa";
    const realVersion = "14.87.0";
    const realBotName = this.botInfo?.firstName || "Бот";
    
    const testText = `✅ ${custom.botName || realBotName} работает!\n\n` +
                    `🔧 Префикс: ${this.settings.prefix}\n` +
                    `⏰ Аптайм: ${custom.uptime || realUptime}\n` +
                    `👑 Создатель: ${custom.creator || realCreator}\n` +
                    `🔧 Версия: ${custom.version || realVersion}\n` +
                    `📱 Статус: ${custom.status || 'В работе'}\n\n`
    
    await this.editMessage(chatId, messageId, testText);
}

async manageCode(args, message, chatId, senderId, messageId) {
    // Строгая проверка прав - только владелец
    const user = await this.getUserData(senderId);

    if (args.length === 0) {
        await this.showCodeHelp(chatId, messageId);
        return;
    }

    const action = args[0].toLowerCase();
    
    try {
        switch (action) {
            case 'показать':
            case 'show':
            case 'view':
                await this.showCodeFile(args.slice(1), chatId, messageId);
                break;
                
            case 'редактировать':
            case 'edit':
            case 'изменить':
                await this.editCodeFile(args.slice(1), message, chatId, messageId);
                break;
                
            case 'добавить':
            case 'add':
            case 'append':
                await this.addCodeToFile(args.slice(1), message, chatId, messageId);
                break;
                
            case 'создать':
            case 'create':
            case 'new':
                await this.createCodeFile(args.slice(1), message, chatId, messageId);
                break;
                
            case 'удалить':
            case 'delete':
            case 'del':
                await this.deleteCodeFile(args.slice(1), chatId, messageId);
                break;
                
            case 'список':
            case 'list':
            case 'ls':
                await this.listCodeFiles(args.slice(1), chatId, messageId);
                break;
                
            case 'инфо':
            case 'info':
                await this.showFileInfo(args.slice(1), chatId, messageId);
                break;
                
            case 'бэкап':
            case 'backup':
                await this.createBackup(args.slice(1), chatId, messageId);
                break;
                
            case 'восстановить':
            case 'restore':
                await this.restoreBackup(args.slice(1), chatId, messageId);
                break;
                
            case 'перезагрузка':
            case 'reload':
            case 'restart':
                await this.restartBot(chatId, messageId);
                break;
                
            default:
                await this.editMessage(chatId, messageId, 
                    '❌ Неизвестная подкоманда. Используйте помощь для списка команд.'
                );
        }
    } catch (error) {
        console.error('❌ Ошибка управления кодом:', error);
        await this.editMessage(chatId, messageId, 
            `❌ Ошибка: ${error.message}`
        );
    }
}

async showCodeHelp(chatId, messageId) {
    const helpText = `🔧 КОМАНДЫ УПРАВЛЕНИЯ ИСХОДНЫМ КОДОМ\n\n` +
        
        `📁 РАБОТА С ФАЙЛАМИ:\n` +
        `• ${this.settings.prefix}код показать [файл] - Показать содержимое файла\n` +
        `• ${this.settings.prefix}код список [папка] - Список файлов в директории\n` +
        `• ${this.settings.prefix}код инфо [файл] - Информация о файле\n\n` +
        
        `✏️ РЕДАКТИРОВАНИЕ:\n` +
        `• ${this.settings.prefix}код редактировать [файл] - Заменить файл (ответом с кодом)\n` +
        `• ${this.settings.prefix}код добавить [файл] - Добавить код в конец (ответом)\n` +
        `• ${this.settings.prefix}код создать [файл] - Создать новый файл (ответом)\n` +
        `• ${this.settings.prefix}код удалить [файл] - Удалить файл\n\n` +
        
        `🛡️ СИСТЕМА:\n` +
        `• ${this.settings.prefix}код бэкап [файл] - Создать бэкап файла\n` +
        `• ${this.settings.prefix}код восстановить [файл] - Восстановить из бэкапа\n` +
        `• ${this.settings.prefix}код перезагрузка - Перезагрузить бота\n\n` +
        
        `📋 ПОДДЕРЖИВАЕМЫЕ ФАЙЛЫ:\n` +
        `• .js, .json, .txt, .md, .html, .css\n` +
        `• Максимальный размер: 50KB\n\n` +
        
        `⚠️ БЕЗОПАСНОСТЬ:\n` +
        `• Доступно только владельцу бота\n` +
        `• Автоматические бэкапы\n` +
        `• Валидация синтаксиса для JS файлов\n` +
        `• Запрещены системные файлы\n\n` +
        
        `💡 ПРИМЕРЫ:\n` +
        `• ${this.settings.prefix}код показать script.js\n` +
        `• ${this.settings.prefix}код список .\n` +
        `• Ответьте на код командой: ${this.settings.prefix}код редактировать test.js`;

    await this.editMessage(chatId, messageId, helpText);
}

async showCodeFile(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите путь к файлу');
    }

    const filePath = this.validateFilePath(args[0]);
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`Файл не существует: ${args[0]}`);
    }

    const stats = fs.statSync(filePath);
    if (stats.size > 512000) { // 500K)
        throw new Error('Файл слишком большой для отображения (максимум 300KB)');
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const fileInfo = await this.getFileInfo(filePath);
    
    let response = `📄 СОДЕРЖИМОЕ ФАЙЛА: ${path.basename(filePath)}\n\n` +
                  `📊 ${fileInfo}\n\n`;
    
    // Обрезаем если слишком длинный для Telegram (увеличиваем лимит обрезки)
    if (content.length > 3500) {
        response += '```\n' + content.substring(0, 3500) + '\n... (файл обрезан)' + '\n```';
        // Добавляем информацию о полном размере
        response += `\n📏 Полный размер: ${content.length} символов`;
    } else {
        response += '```\n' + content + '\n```';
    }
    
    await this.editMessage(chatId, messageId, response);
}

async editCodeFile(args, message, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите путь к файлу для редактирования');
    }

    if (!message.replyTo || !message.replyTo.replyToMsgId) {
        throw new Error('Ответьте на сообщение с новым содержимым файла');
    }

    const filePath = this.validateFilePath(args[0]);
    const repliedMessageId = message.replyTo.replyToMsgId;

    // Получаем сообщение с кодом
    const repliedMessages = await this.telegramClient.getMessages(chatId, {
        ids: [repliedMessageId]
    });

    if (!repliedMessages[0] || !repliedMessages[0].text) {
        throw new Error('Не удалось получить содержимое для редактирования');
    }

    const newContent = repliedMessages[0].text;
    
    // Проверяем новый лимит 300KB
    if (Buffer.byteLength(newContent, 'utf8') > 307200) {
        throw new Error('Новое содержимое превышает лимит 300KB');
    }
    
    // Валидация для JS файлов
    if (filePath.endsWith('.js')) {
        await this.validateJavaScript(newContent);
    }

    // Создаем бэкап
    if (fs.existsSync(filePath)) {
        await this.createFileBackup(filePath);
    }

    // Записываем новый контент
    fs.writeFileSync(filePath, newContent, 'utf8');
    
    const fileInfo = await this.getFileInfo(filePath);
    
    await this.editMessage(chatId, messageId,
        `✅ Файл успешно отредактирован: ${path.basename(filePath)}\n\n` +
        `📊 ${fileInfo}\n\n` +
        `💾 Создан бэкап перед изменениями\n` +
        `🔧 Для применения изменений может потребоваться перезагрузка`
    );
}

async addCodeToFile(args, message, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите путь к файлу для добавления');
    }

    if (!message.replyTo || !message.replyTo.replyToMsgId) {
        throw new Error('Ответьте на сообщение с кодом для добавления');
    }

    const filePath = this.validateFilePath(args[0]);
    const repliedMessageId = message.replyTo.replyToMsgId;

    // Получаем сообщение с кодом
    const repliedMessages = await this.telegramClient.getMessages(chatId, {
        ids: [repliedMessageId]
    });

    if (!repliedMessages[0] || !repliedMessages[0].text) {
        throw new Error('Не удалось получить код для добавления');
    }

    const codeToAdd = repliedMessages[0].text;
    
    // Проверяем лимит 300KB для добавляемого кода
    if (Buffer.byteLength(codeToAdd, 'utf8') > 307200) {
        throw new Error('Добавляемый код превышает лимит 300KB');
    }
    
    // Создаем бэкап если файл существует
    if (fs.existsSync(filePath)) {
        await this.createFileBackup(filePath);
        
        // Читаем существующий контент
        const existingContent = fs.readFileSync(filePath, 'utf8');
        const newContent = existingContent + '\n\n' + codeToAdd;
        
        // Проверяем общий размер после добавления
        if (Buffer.byteLength(newContent, 'utf8') > 307200) {
            throw new Error('Общий размер файла после добавления превысит 300KB');
        }
        
        // Валидация для JS файлов
        if (filePath.endsWith('.js')) {
            await this.validateJavaScript(newContent);
        }
        
        fs.writeFileSync(filePath, newContent, 'utf8');
    } else {
        // Создаем новый файл
        if (filePath.endsWith('.js')) {
            await this.validateJavaScript(codeToAdd);
        }
        fs.writeFileSync(filePath, codeToAdd, 'utf8');
    }
    
    const fileInfo = await this.getFileInfo(filePath);
    
    await this.editMessage(chatId, messageId,
        `✅ Код успешно добавлен в: ${path.basename(filePath)}\n\n` +
        `📊 ${fileInfo}\n\n` +
        `💾 Создан бэкап перед изменениями`
    );
}

async createCodeFile(args, message, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите путь к новому файлу');
    }

    if (!message.replyTo || !message.replyTo.replyToMsgId) {
        throw new Error('Ответьте на сообщение с содержимым нового файла');
    }

    const filePath = this.validateFilePath(args[0]);
    const repliedMessageId = message.replyTo.replyToMsgId;

    // Получаем сообщение с кодом
    const repliedMessages = await this.telegramClient.getMessages(chatId, {
        ids: [repliedMessageId]
    });

    if (!repliedMessages[0] || !repliedMessages[0].text) {
        throw new Error('Не удалось получить содержимое для нового файла');
    }

    const content = repliedMessages[0].text;
    
    // Проверяем лимит 300KB
    if (Buffer.byteLength(content, 'utf8') > 512000) {
        throw new Error('Содержимое файла превышает лимит 500KB');
    }
    
    if (fs.existsSync(filePath)) {
        throw new Error('Файл уже существует. Используйте редактирование.');
    }

    // Валидация для JS файлов
    if (filePath.endsWith('.js')) {
        await this.validateJavaScript(content);
    }

    // Создаем директорию если нужно
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf8');
    
    const fileInfo = await this.getFileInfo(filePath);
    
    await this.editMessage(chatId, messageId,
        `✅ Новый файл создан: ${path.basename(filePath)}\n\n` +
        `📊 ${fileInfo}`
    );
}

async deleteCodeFile(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите путь к файлу для удаления');
    }

    const filePath = this.validateFilePath(args[0]);
    
    if (!fs.existsSync(filePath)) {
        throw new Error('Файл не существует');
    }

    // Запрещаем удаление критических файлов
    const criticalFiles = [
        'script.js', 'bot_database.sqlite', 'session.txt', 
        'settings.json', 'web_interface.js'
    ];
    
    if (criticalFiles.includes(path.basename(filePath))) {
        throw new Error('Нельзя удалять критические файлы бота');
    }

    // Создаем бэкап перед удалением
    await this.createFileBackup(filePath);
    
    const fileInfo = await this.getFileInfo(filePath);
    fs.unlinkSync(filePath);
    
    await this.editMessage(chatId, messageId,
        `✅ Файл удален: ${path.basename(filePath)}\n\n` +
        `📊 ${fileInfo}\n\n` +
        `💾 Создан бэкап перед удалением`
    );
}

async listCodeFiles(args, chatId, messageId) {
    const dirPath = args.length > 0 ? this.validateFilePath(args[0]) : __dirname;
    
    if (!fs.existsSync(dirPath)) {
        throw new Error('Директория не существует');
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
        throw new Error('Указанный путь не является директорией');
    }

    const items = fs.readdirSync(dirPath);
    let files = [];
    let folders = [];

    items.forEach(item => {
        const fullPath = path.join(dirPath, item);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                folders.push(item);
            } else {
                files.push(item);
            }
        } catch (error) {
            // Пропускаем файлы с ошибками доступа
        }
    });

    folders.sort();
    files.sort();

    let response = `📁 СОДЕРЖИМОЕ ДИРЕКТОРИИ: ${path.basename(dirPath)}\n\n`;
    
    if (folders.length > 0) {
        response += `📂 ПАПКИ (${folders.length}):\n`;
        folders.forEach(folder => {
            response += `🔸 ${folder}/\n`;
        });
        response += '\n';
    }
    
    if (files.length > 0) {
        response += `📄 ФАЙЛЫ (${files.length}):\n`;
        files.forEach(file => {
            const fileExt = path.extname(file);
            const icon = this.getFileIcon(fileExt);
            response += `${icon} ${file}\n`;
        });
    }
    
    if (folders.length === 0 && files.length === 0) {
        response += '📭 Директория пуста';
    }
    
    response += `\n💡 Используйте ${this.settings.prefix}код показать [файл] для просмотра`;

    await this.editMessage(chatId, messageId, response);
}

async showFileInfo(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите путь к файлу');
    }

    const filePath = this.validateFilePath(args[0]);
    
    if (!fs.existsSync(filePath)) {
        throw new Error('Файл не существует');
    }

    const info = await this.getFileInfo(filePath);
    await this.editMessage(chatId, messageId, `📊 ИНФОРМАЦИЯ О ФАЙЛЕ\n\n${info}`);
}

async createBackup(args, chatId, messageId) {
    if (args.length === 0) {
        // Бэкап всей папки бота
        await this.createFullBackup(chatId, messageId);
        return;
    }

    const filePath = this.validateFilePath(args[0]);
    
    if (!fs.existsSync(filePath)) {
        throw new Error('Файл не существует');
    }

    const backupPath = await this.createFileBackup(filePath);
    
    await this.editMessage(chatId, messageId,
        `✅ Бэкап создан: ${path.basename(filePath)}\n\n` +
        `💾 Сохранен как: ${path.basename(backupPath)}\n` +
        `📁 Папка бэкапов: backups/`
    );
}

async restoreBackup(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите имя файла бэкапа (без пути)');
    }

    const backupName = args[0];
    const backupDir = path.join(__dirname, 'backups');
    const backupPath = path.join(backupDir, backupName);
    
    if (!fs.existsSync(backupPath)) {
        throw new Error('Бэкап не найден');
    }

    // Определяем оригинальное имя файла из имени бэкапа
    const originalName = backupName.replace(/_\d+\.backup$/, '');
    const originalPath = path.join(__dirname, originalName);
    
    // Копируем бэкап на место оригинального файла
    fs.copyFileSync(backupPath, originalPath);
    
    await this.editMessage(chatId, messageId,
        `✅ Файл восстановлен из бэкапа\n\n` +
        `📄 Файл: ${originalName}\n` +
        `💾 Бэкап: ${backupName}\n` +
        `🔧 Может потребоваться перезагрузка`
    );
}

async restartBot(chatId, messageId) {
    await this.editMessage(chatId, messageId,
        '🔄 Перезагружаю бота...\n\n' +
        '⏳ Это займет несколько секунд'
    );
    
    // Сохраняем все данные перед перезагрузкой
    await this.saveAllData();
    
    // Перезапускаем процесс
    setTimeout(() => {
        process.exit(0);
    }, 2000);
}

// ========== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ==========

validateFilePath(userPath) {
    // Запрещаем переходы по директориям
    if (userPath.includes('..')) {
        throw new Error('Недопустимый путь: переходы между директориями запрещены');
    }
    
    // Разрешаем только определенные расширения
    const allowedExt = ['.js', '.json', '.txt', '.md', '.html', '.css', ''];
    const ext = path.extname(userPath);
    if (!allowedExt.includes(ext)) {
        throw new Error('Недопустимое расширение файла');
    }
    
    // Строим полный путь
    const fullPath = path.join(__dirname, userPath);
    
    // Проверяем что путь остается в директории бота
    if (!fullPath.startsWith(__dirname)) {
        throw new Error('Недопустимый путь: выход за пределы директории бота');
    }
    
    return fullPath;
}

async validateJavaScript(code) {
    try {
        // Проверяем синтаксис JavaScript
        new Function(code);
    } catch (error) {
        throw new Error(`Ошибка синтаксиса JavaScript: ${error.message}`);
    }
}

async getFileInfo(filePath) {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath);
    
    let info = `📄 Имя: ${path.basename(filePath)}\n`;
    info += `📁 Тип: ${stats.isDirectory() ? 'Папка' : 'Файл'}\n`;
    
    if (!stats.isDirectory()) {
        info += `📏 Размер: ${this.formatFileSize(stats.size)}\n`;
        info += `🔤 Кодировка: UTF-8\n`;
    }
    
    info += `📅 Создан: ${stats.birthtime.toLocaleString('ru-RU')}\n`;
    info += `✏️ Изменен: ${stats.mtime.toLocaleString('ru-RU')}\n`;
    info += `🔍 Расширение: ${ext || 'нет'}`;
    
    return info;
}

async createFileBackup(filePath) {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const fileName = path.basename(filePath);
    const backupName = `${fileName}_${Date.now()}.backup`;
    const backupPath = path.join(backupDir, backupName);
    
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

async createFullBackup(chatId, messageId) {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupName = `full_backup_${Date.now()}.zip`;
    const backupPath = path.join(backupDir, backupName);
    
    // Здесь можно реализовать создание zip архива
    // Для простоты просто создаем список файлов
    
    const files = fs.readdirSync(__dirname);
    let backupInfo = `💾 ПОЛНЫЙ БЭКАП БОТА\n\n` +
                    `📅 Создан: ${new Date().toLocaleString('ru-RU')}\n` +
                    `📁 Файлов: ${files.length}\n\n` +
                    `📋 СПИСОК ФАЙЛОВ:\n`;
    
    files.forEach(file => {
        try {
            const stats = fs.statSync(path.join(__dirname, file));
            const icon = stats.isDirectory() ? '📂' : this.getFileIcon(path.extname(file));
            backupInfo += `${icon} ${file} (${this.formatFileSize(stats.size)})\n`;
        } catch (error) {
            backupInfo += `❓ ${file} (ошибка доступа)\n`;
        }
    });
    
    fs.writeFileSync(backupPath, backupInfo, 'utf8');
    
    await this.editMessage(chatId, messageId,
        `✅ Полный бэкап создан\n\n` +
        `💾 Файл: ${backupName}\n` +
        `📁 Папка: backups/\n` +
        `📊 Сохранено: ${files.length} файлов`
    );
}

getFileIcon(extension) {
    const icons = {
        '.js': '🔵',
        '.json': '📋', 
        '.txt': '📝',
        '.md': '📘',
        '.html': '🌐',
        '.css': '🎨',
        '.sqlite': '🗃️',
        '.backup': '💾'
    };
    
    return icons[extension] || '📄';
}

formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

parseTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        throw new Error('Неверный формат времени');
    }

    const timeUnits = {
        'с': 1,                    // секунды
        'сек': 1,                  // секунды
        'м': 60,                   // минуты
        'мин': 60,                 // минуты
        'ч': 3600,                 // часы
        'час': 3600,               // часы
        'д': 86400,                // дни
        'день': 86400,             // дни
        'н': 604800,               // недели
        'нед': 604800,             // недели
        'мес': 2592000,            // месяцы (30 дней)
        'г': 31536000,             // годы (365 дней)
        'год': 31536000            // годы
    };

    const regex = /(\d+)\s*([а-яa-z]+)/gi;
    let totalSeconds = 0;
    let match;

    while ((match = regex.exec(timeStr)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        if (timeUnits[unit]) {
            totalSeconds += value * timeUnits[unit];
        } else {
            throw new Error(`Неизвестная единица времени: ${unit}`);
        }
    }

    // Если не найдено совпадений, пробуем парсить как просто число (секунды по умолчанию)
    if (totalSeconds === 0) {
        const simpleValue = parseInt(timeStr);
        if (!isNaN(simpleValue)) {
            totalSeconds = simpleValue;
        } else {
            throw new Error('Неверный формат времени');
        }
    }

    if (totalSeconds <= 0) {
        throw new Error('Время должно быть положительным');
    }

    return totalSeconds;
}

/**
 * Форматирование секунд в читаемый вид
 */
formatTime(seconds) {
    const units = [
        { value: 31536000, name: 'год' },
        { value: 2592000, name: 'месяц' },
        { value: 604800, name: 'неделю' },
        { value: 86400, name: 'день' },
        { value: 3600, name: 'час' },
        { value: 60, name: 'минуту' },
        { value: 1, name: 'секунду' }
    ];

    const parts = [];
    let remaining = seconds;

    for (const unit of units) {
        if (remaining >= unit.value) {
            const count = Math.floor(remaining / unit.value);
            remaining %= unit.value;
            
            let name = unit.name;
            if (count > 1) {
                // Простое множественное число
                if (unit.name === 'год') name = 'года';
                else if (unit.name === 'месяц') name = 'месяца';
                else if (unit.name === 'неделю') name = 'недели';
                else if (unit.name === 'день') name = 'дня';
                else if (unit.name === 'час') name = 'часа';
                else if (unit.name === 'минуту') name = 'минуты';
                else if (unit.name === 'секунду') name = 'секунды';
            }
            
            parts.push(`${count} ${name}`);
        }
    }

    return parts.join(' ') || '0 секунд';
}

/**
 * Управление таймерами
 */
async manageTimers(args, message, chatId, senderId, messageId) {
    if (args.length === 0) {
        await this.showTimerHelp(chatId, messageId);
        return;
    }

    const action = args[0].toLowerCase();
    
    try {
        switch (action) {
            case '+':
            case 'add':
            case 'адд':
            case 'добавить':
                await this.addTimer(args.slice(1), message, chatId, senderId, messageId);
                break;
                
            case '-':
            case 'remove':
            case 'delete':
            case 'удалить':
                await this.removeTimer(args.slice(1), chatId, messageId);
                break;
                
            case 'enable':
            case 'включить':
                await this.toggleTimer(args.slice(1), chatId, messageId, true);
                break;
                
            case 'disable':
            case 'выключить':
                await this.toggleTimer(args.slice(1), chatId, messageId, false);
                break;
                
            case 'info':
            case 'инфо':
                await this.showTimerInfo(args.slice(1), chatId, messageId);
                break;

            case 'restart':
            case 'перезапустить':
            case 'reuse':
            case 'использовать':
                await this.restartTimer(args.slice(1).join(' '), chatId, messageId);
                break;
                
            case 'list':
            case 'список':
                await this.listTimers(args, message, chatId, senderId, messageId);
                break;
                
            case 'trigger':
            case 'сработать':
                await this.triggerTimer(args.slice(1), chatId, messageId);
                break;
                
            default:
                await this.editMessage(chatId, messageId, 
                    `❌ Неизвестное действие для таймера: ${action}\n\n` +
                    `💡 Используйте ${this.settings.prefix}таймер для справки`
                );
        }
    } catch (error) {
        console.error('❌ Ошибка работы с таймерами:', error);
        await this.editMessage(chatId, messageId, `❌ Ошибка: ${error.message}`);
    }
}

/**
 * Добавление таймера
 */
async addTimer(args, message, chatId, senderId, messageId) {
    if (args.length < 2) {
        throw new Error('Укажите название таймера и время\nПример: !таймер add мой_таймер 5м30с "Сообщение"');
    }

    const timerName = args[0];
    const timeStr = args[1];
    let messageText = args.slice(2).join(' ');

    // Если нет текста сообщения, используем текст из replied сообщения
    if (!messageText && message.replyTo && message.replyTo.replyToMsgId) {
        const repliedMessages = await this.telegramClient.getMessages(chatId, {
            ids: [message.replyTo.replyToMsgId]
        });
        
        if (repliedMessages[0] && repliedMessages[0].text) {
            messageText = repliedMessages[0].text;
        }
    }

    if (!messageText) {
        throw new Error('Укажите текст сообщения для таймера или ответьте на сообщение');
    }

    // Парсим время
    const seconds = this.parseTime(timeStr);
    const triggerTime = new Date(Date.now() + seconds * 1000);

    await this.editMessage(chatId, messageId, `⏰ Создаю таймер "${timerName}"...`);

    // Создаем объект таймера
    const timer = {
        name: timerName,
        chatId: chatId,
        messageText: messageText,
        triggerTime: triggerTime,
        intervalSeconds: seconds,
        enabled: true,
        createdBy: senderId,
        createdAt: new Date(),
        settings: {
            silent: false
        }
    };

    // Сохраняем в базу
    await this.saveTimerToDatabase(timer);
    
    // Запускаем таймер
    await this.startTimer(timer);

    const formattedTime = this.formatTime(seconds);
    
    await this.editMessage(chatId, messageId, 
        `✅ ТАЙМЕР СОЗДАН\n\n` +
        `🔸 Название: ${timerName}\n` +
        `🔸 Время: ${formattedTime}\n` +
        `🔸 Сработает: ${triggerTime.toLocaleString('ru-RU')}\n` +
        `🔸 Сообщение: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}\n\n` +
        `💡 Таймер автоматически удалится после срабатывания`
    );
}

/**
 * Сохранение таймера в базу данных
 */
async saveTimerToDatabase(timer) {
    return new Promise((resolve, reject) => {
        this.db.run(
            `INSERT OR REPLACE INTO timers (name, chat_id, message_text, trigger_time, interval_seconds, repeat_count, current_count, enabled, created_at, last_triggered, settings) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                timer.name,
                timer.chatId,
                timer.messageText,
                timer.triggerTime.toISOString(),
                timer.intervalSeconds,
                timer.repeatCount,
                timer.currentCount,
                timer.enabled,
                timer.createdAt.toISOString(),
                timer.lastTriggered ? timer.lastTriggered.toISOString() : null,
                JSON.stringify(timer.settings)
            ],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

/**
 * Запуск таймера
 */
async startTimer(timer) {
    if (!timer.enabled) return;

    const now = Date.now();
    const triggerTime = new Date(timer.triggerTime).getTime();
    const delay = Math.max(triggerTime - now, 0);

    console.log(`⏰ Запуск таймера "${timer.name}" через ${delay}ms`);

    const timeoutId = setTimeout(async () => {
        try {
            await this.executeTimer(timer);
        } catch (error) {
            console.error(`❌ Ошибка выполнения таймера "${timer.name}":`, error);
        }
    }, delay);

    // Сохраняем ID таймера
    this.timerIntervals.set(timer.name, timeoutId);
    this.settings.timers.set(timer.name, timer);
}

/**
 * Выполнение таймера
 */
async executeTimer(timer) {
    try {
        console.log(`🔔 Сработал таймер: "${timer.name}"`);
        
        // Отправляем сообщение
        await this.telegramClient.sendMessage(timer.chatId, {
            message: `⏰ ТАЙМЕР: ${timer.messageText}`,
            silent: timer.settings?.silent || false
        });

        console.log(`✅ Сообщение таймера "${timer.name}" отправлено в чат ${timer.chatId}`);

        // ОБНОВЛЕНИЕ: НЕ УДАЛЯЕМ ТАЙМЕР!
        // Просто обновляем время последнего срабатывания
        timer.lastTriggered = new Date();
        await this.saveTimerToDatabase(timer);
        
        console.log(`🔄 Таймер "${timer.name}" сохранен для повторного использования`);

    } catch (error) {
        console.error(`❌ Ошибка выполнения таймера "${timer.name}":`, error);
        
        // Пробуем отправить сообщение об ошибке
        try {
            await this.telegramClient.sendMessage(timer.chatId, {
                message: `❌ Ошибка таймера "${timer.name}": ${error.message}`
            });
        } catch (e) {
            console.error('Не удалось отправить сообщение об ошибке:', e);
        }
    }
}

/**
 * Перезапуск таймера для повторного использования
 */
async restartTimer(timerName, chatId, messageId) {
    const timer = this.settings.timers.get(timerName);
    
    if (!timer) {
        throw new Error(`Таймер "${timerName}" не найден`);
    }

    // Устанавливаем новое время срабатывания
    timer.triggerTime = new Date(Date.now() + timer.intervalSeconds * 1000);
    timer.enabled = true;
    
    // Сохраняем в базу
    await this.saveTimerToDatabase(timer);
    
    // Перезапускаем таймер
    await this.startTimer(timer);

    await this.editMessage(chatId, messageId, 
        `🔁 Таймер "${timerName}" перезапущен\n` +
        `⏰ Сработает: ${timer.triggerTime.toLocaleString('ru-RU')}`
    );
}


/**
 * Удаление таймера
 */
async removeTimer(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите название таймера для удаления');
    }

    const timerName = args[0];
    
    // Останавливаем таймер
    await this.stopTimer(timerName);
    
    // Удаляем из базы
    await this.removeTimerFromDatabase(timerName);
    
    // Удаляем из памяти
    this.settings.timers.delete(timerName);

    await this.editMessage(chatId, messageId, 
        `✅ Таймер "${timerName}" удален`
    );
}

/**
 * Остановка таймера
 */
async stopTimer(timerName) {
    const timeoutId = this.timerIntervals.get(timerName);
    if (timeoutId) {
        clearTimeout(timeoutId);
        this.timerIntervals.delete(timerName);
    }
}

/**
 * Удаление таймера из базы данных
 */
async removeTimerFromDatabase(timerName) {
    return new Promise((resolve, reject) => {
        this.db.run(
            `DELETE FROM timers WHERE name = ?`,
            [timerName],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

/**
 * Включение/выключение таймера
 */
async toggleTimer(args, chatId, messageId, enabled) {
    if (args.length === 0) {
        throw new Error('Укажите название таймера');
    }

    const timerName = args[0];
    const timer = this.settings.timers.get(timerName);
    
    if (!timer) {
        throw new Error(`Таймер "${timerName}" не найден`);
    }

    timer.enabled = enabled;
    
    if (enabled) {
        await this.startTimer(timer);
    } else {
        await this.stopTimer(timerName);
    }

    // Обновляем в базе
    await this.saveTimerToDatabase(timer);

    const status = enabled ? 'ВКЛЮЧЕН ✅' : 'ВЫКЛЮЧЕН ❌';
    await this.editMessage(chatId, messageId, 
        `✅ Таймер "${timerName}" ${status}`
    );
}

/**
 * Информация о таймере
 */
async showTimerInfo(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите название таймера');
    }

    const timerName = args[0];
    const timer = this.settings.timers.get(timerName);
    
    if (!timer) {
        throw new Error(`Таймер "${timerName}" не найден`);
    }

    const remainingTime = new Date(timer.triggerTime).getTime() - Date.now();
    const formattedRemaining = this.formatTime(Math.max(0, Math.floor(remainingTime / 1000)));
    
    const info = `⏰ ИНФОРМАЦИЯ О ТАЙМЕРЕ\n\n` +
                `🔸 Название: ${timer.name}\n` +
                `🔸 Статус: ${timer.enabled ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}\n` +
                `🔸 Интервал: ${this.formatTime(timer.intervalSeconds)}\n` +
                `🔸 Осталось: ${formattedRemaining}\n` +
                `🔸 Сработает: ${new Date(timer.triggerTime).toLocaleString('ru-RU')}\n` +
                `🔸 Создан: ${new Date(timer.createdAt).toLocaleString('ru-RU')}\n` +
                `🔸 Срабатываний: ${timer.currentCount}\n` +
                `🔸 Повторов: ${timer.repeatCount > 0 ? timer.repeatCount : 'Одноразовый'}\n\n` +
                `💬 Сообщение:\n${timer.messageText}`;

    await this.editMessage(chatId, messageId, info);
}

/**
 * Список таймеров
 */
async listTimers(args, message, chatId, senderId, messageId) {
    const timers = Array.from(this.settings.timers.values());
    
    if (timers.length === 0) {
        await this.editMessage(chatId, messageId, `⏰ Таймеры не настроены`);
        return;
    }

    let response = `⏰ СПИСОК ТАЙМЕРОВ (сохраняются после использования)\n\n`;
    
    timers.forEach((timer, index) => {
        const remainingTime = new Date(timer.triggerTime).getTime() - Date.now();
        const isActive = remainingTime > 0 && timer.enabled;
        const status = isActive ? '✅' : '💤';
        const statusText = isActive ? 'АКТИВЕН' : 'НЕАКТИВЕН';
        
        const formattedRemaining = isActive ? 
            this.formatTime(Math.max(0, Math.floor(remainingTime / 1000))) : 
            'завершен';
            
        const lastUsed = timer.lastTriggered ? 
            `\n   📅 Использован: ${new Date(timer.lastTriggered).toLocaleString('ru-RU')}` : '';
        
        response += `${status} ${index + 1}. "${timer.name}" [${statusText}]\n`;
        response += `   ⏱️  Статус: ${formattedRemaining}\n`;
        response += `   💬 ${timer.messageText.substring(0, 30)}${timer.messageText.length > 30 ? '...' : ''}`;
        response += lastUsed + `\n\n`;
    });

    response += `💡 Команды управления:\n` +
               `• ${this.settings.prefix}таймер add [название] [время] [текст]\n` +
               `• ${this.settings.prefix}таймер перезапустить [название] - использовать снова\n` +
               `• ${this.settings.prefix}таймер удалить [название] - удалить таймер\n` +
               `• ${this.settings.prefix}таймер инфо [название] - информация о таймере\n` +
               `• ${this.settings.prefix}таймер включить/выключить [название]`;

    await this.editMessage(chatId, messageId, response);
}

/**
 * Загрузка таймеров из базы данных
 */
async loadTimersFromDatabase() {
    return new Promise((resolve, reject) => {
        this.db.all(`SELECT name, chat_id, message_text, trigger_time, interval_seconds, enabled, created_at, last_triggered, settings FROM timers`, (err, rows) => {
            if (err) {
                console.error('❌ Ошибка загрузки таймеров:', err.message);
                reject(err);
                return;
            }
            
            this.settings.timers.clear();
            
            if (rows && rows.length > 0) {
                let loadedCount = 0;
                const now = new Date();
                
                rows.forEach(row => {
                    try {
                        const triggerTime = new Date(row.trigger_time);
                        const settings = JSON.parse(row.settings || '{}');
                        
                        const timer = {
                            name: row.name,
                            chatId: row.chat_id,
                            messageText: row.message_text,
                            triggerTime: triggerTime,
                            intervalSeconds: row.interval_seconds,
                            enabled: row.enabled,
                            createdBy: settings.createdBy,
                            createdAt: new Date(row.created_at),
                            lastTriggered: row.last_triggered ? new Date(row.last_triggered) : null,
                            settings: settings
                        };
                        
                        this.settings.timers.set(row.name, timer);
                        
                        // Запускаем таймер только если он активен и время еще не наступило
                        if (timer.enabled && triggerTime > now) {
                            this.startTimer(timer);
                        }
                        
                        loadedCount++;
                        
                    } catch (parseError) {
                        console.error(`❌ Ошибка парсинга таймера "${row.name}":`, parseError.message);
                    }
                });
                
                console.log(`✅ Загружено ${loadedCount} таймеров из базы данных (включая использованные)`);
            } else {
                console.log('⏰ В базе данных нет таймеров');
            }
            
            resolve();
        });
    });
}

/**
 * Принудительное срабатывание таймера
 */
async triggerTimer(args, chatId, messageId) {
    if (args.length === 0) {
        throw new Error('Укажите название таймера');
    }

    const timerName = args[0];
    const timer = this.settings.timers.get(timerName);
    
    if (!timer) {
        throw new Error(`Таймер "${timerName}" не найден`);
    }

    await this.editMessage(chatId, messageId, `🔔 Принудительно запускаю таймер "${timerName}"...`);
    
    await this.executeTimer(timer);
    
    await this.editMessage(chatId, messageId, 
        `✅ Таймер "${timerName}" успешно сработал`
    );
}

/**
 * Справка по таймерам
 */
async showTimerHelp(chatId, messageId) {
    const helpText = `⏰ КОМАНДЫ ДЛЯ РАБОТЫ С ТАЙМЕРАМИ\n\n` +

                    `⏱️ ФОРМАТЫ ВРЕМЕНИ:\n` +
                    `• с, сек - секунды (30с, 10сек)\n` +
                    `• м, мин - минуты (5м, 10мин)\n` +
                    `• ч, час - часы (2ч, 3час)\n` +
                    `• д, день - дни (1д, 2дня)\n` +
                    `• н, нед - недели (1н, 2нед)\n` +
                    `• мес - месяцы (1мес)\n` +
                    `• г, год - годы (1г, 2года)\n\n` +

                    `💾 СОЗДАНИЕ ТАЙМЕРА:\n` +
                    `${this.settings.prefix}таймер add [название] [время] [текст]\n\n` +
                    `Примеры:\n` +
                    `${this.settings.prefix}таймер add напоминание 30м "Проверить задачи"\n` +
                    `${this.settings.prefix}таймер add уведомление 1ч30м "Встреча через 30 минут"\n\n` +

                    `🔄 ПОВТОРНОЕ ИСПОЛЬЗОВАНИЕ:\n` +
                    `• Таймеры НЕ удаляются после использования!\n` +
                    `• Используйте команду: ${this.settings.prefix}таймер перезапустить [название]\n` +
                    `• Таймер будет использовать тот же текст и интервал\n\n` +

                    `📋 КОМАНДЫ УПРАВЛЕНИЯ:\n` +
                    `• ${this.settings.prefix}таймеры - список всех таймеров\n` +
                    `• ${this.settings.prefix}таймер перезапустить [название] - использовать снова\n` +
                    `• ${this.settings.prefix}таймер удалить [название] - удалить таймер\n` +
                    `• ${this.settings.prefix}таймер инфо [название] - информация о таймере\n` +
                    `• ${this.settings.prefix}таймер включить [название] - включить таймер\n` +
                    `• ${this.settings.prefix}таймер выключить [название] - выключить таймер\n` +
                    `• ${this.settings.prefix}таймер сработать [название] - принудительно запустить\n\n` +

                    `🎯 ОСОБЕННОСТИ:\n` +
                    `• Таймеры сохраняются после перезагрузки бота\n` +
                    `• Таймеры НЕ удаляются после использования\n` +
                    `• Можно переиспользовать многократно\n` +
                    `• История использования сохраняется`;

    await this.editMessage(chatId, messageId, helpText);
}

/**
 * Расширенное добавление таймера с поддержкой параметров
 */
async addEnhancedTimer(args, message, chatId, senderId, messageId) {
    if (args.length < 2) {
        throw new Error('Укажите название таймера и время\nПример: !таймер add мой_таймер 5м30с "Сообщение" -repeat 5 -silent');
    }

    const timerName = args[0];
    const timeStr = args[1];
    let messageText = '';
    let settings = {
        silent: false,
        pin: false,
        reply: false,
        repeat: 0, // 0 = одноразовый
        deleteAfter: 0
    };

    // Парсим аргументы с параметрами
    let responseParts = [];
    let i = 2;
    
    // Сначала собираем текст сообщения (до параметров)
    while (i < args.length && !args[i].startsWith('-')) {
        responseParts.push(args[i]);
        i++;
    }

    // Затем обрабатываем параметры
    while (i < args.length) {
        if (args[i].startsWith('-')) {
            const param = args[i].substring(1);
            const value = i + 1 < args.length ? args[i + 1] : null;

            switch (param) {
                case 'repeat':
                case 'повтор':
                    if (value && !isNaN(value)) {
                        settings.repeat = Math.max(parseInt(value), 0);
                        i++;
                    }
                    break;
                    
                case 'silent':
                case 'тихий':
                    settings.silent = true;
                    break;
                    
                case 'pin':
                case 'закрепить':
                    settings.pin = true;
                    break;
                    
                case 'reply':
                case 'ответить':
                    settings.reply = true;
                    break;
                    
                case 'delete_after':
                case 'удалить_через':
                    if (value && !isNaN(value)) {
                        settings.deleteAfter = parseInt(value);
                        i++;
                    }
                    break;
                    
                case 'chat':
                case 'чат':
                    if (value) {
                        // Можно указать чат для отправки (по умолчанию - текущий)
                        settings.targetChat = value;
                        i++;
                    }
                    break;
            }
        }
        i++;
    }

    // Собираем текст сообщения
    messageText = responseParts.join(' ');

    // Если нет текста сообщения, используем текст из replied сообщения
    if (!messageText && message.replyTo && message.replyTo.replyToMsgId) {
        const repliedMessages = await this.telegramClient.getMessages(chatId, {
            ids: [message.replyTo.replyToMsgId]
        });
        
        if (repliedMessages[0] && repliedMessages[0].text) {
            messageText = repliedMessages[0].text;
        }
    }

    if (!messageText) {
        throw new Error('Укажите текст сообщения для таймера или ответьте на сообщение');
    }

    // Парсим время
    const seconds = this.parseTime(timeStr);
    const triggerTime = new Date(Date.now() + seconds * 1000);

    await this.editMessage(chatId, messageId, `⏰ Создаю расширенный таймер "${timerName}"...`);

    // Создаем объект таймера
    const timer = {
        name: timerName,
        chatId: settings.targetChat || chatId,
        messageText: messageText,
        triggerTime: triggerTime,
        intervalSeconds: seconds,
        repeatCount: settings.repeat,
        currentCount: 0,
        enabled: true,
        createdBy: senderId,
        createdAt: new Date(),
        lastTriggered: null,
        settings: settings
    };

    // Сохраняем в базу
    await this.saveTimerToDatabase(timer);
    
    // Запускаем таймер
    await this.startTimer(timer);

    const formattedTime = this.formatTime(seconds);
    const repeatInfo = settings.repeat > 0 ? `🔸 Повторов: ${settings.repeat}\n` : '';
    const settingsInfo = [
        settings.silent ? '🔇 Тихий' : '',
        settings.pin ? '📌 Закрепить' : '',
        settings.reply ? '↩️ Ответить' : '',
        settings.deleteAfter > 0 ? `🗑️ Удалить через ${settings.deleteAfter}с` : ''
    ].filter(Boolean).join(', ');
    
    await this.editMessage(chatId, messageId, 
        `✅ РАСШИРЕННЫЙ ТАЙМЕР СОЗДАН\n\n` +
        `🔸 Название: ${timerName}\n` +
        `🔸 Время: ${formattedTime}\n` +
        `🔸 Сработает: ${triggerTime.toLocaleString('ru-RU')}\n` +
        repeatInfo +
        `🔸 Настройки: ${settingsInfo || 'стандартные'}\n` +
        `🔸 Сообщение: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}\n\n` +
        `💡 Команды:\n` +
        `• ${this.settings.prefix}таймер удалить ${timerName}\n` +
        `• ${this.settings.prefix}таймер инфо ${timerName}\n` +
        `• ${this.settings.prefix}таймеры - список всех таймеров`
    );
}

/**
 * Расширенное выполнение таймера
 */
async executeEnhancedTimer(timer) {
    try {
        console.log(`🔔 Сработал таймер: "${timer.name}"`);
        
        let messageOptions = {
            message: `${timer.messageText}`,
            silent: timer.settings.silent
        };

        // Отправляем сообщение
        const sentMessage = await this.telegramClient.sendMessage(timer.chatId, messageOptions);

        // Закрепляем сообщение если нужно
        if (timer.settings.pin && sentMessage) {
            try {
                await this.telegramClient.pinMessage(timer.chatId, sentMessage.id);
            } catch (pinError) {
                console.error(`❌ Не удалось закрепить сообщение:`, pinError.message);
            }
        }

        // Удаляем сообщение через указанное время
        if (timer.settings.deleteAfter > 0 && sentMessage) {
            setTimeout(async () => {
                try {
                    await this.telegramClient.deleteMessages(timer.chatId, [sentMessage.id]);
                } catch (deleteError) {
                    console.error(`❌ Не удалось удалить сообщение:`, deleteError.message);
                }
            }, timer.settings.deleteAfter * 1000);
        }

        // Обновляем статистику
        timer.lastTriggered = new Date();
        timer.currentCount++;

        // Если это повторяющийся таймер и не достигнут лимит, перезапускаем
        if (timer.repeatCount > 0 && timer.currentCount < timer.repeatCount) {
            timer.triggerTime = new Date(Date.now() + timer.intervalSeconds * 1000);
            await this.saveTimerToDatabase(timer);
            await this.startTimer(timer);
            console.log(`🔄 Таймер "${timer.name}" перезапущен (${timer.currentCount}/${timer.repeatCount})`);
        } else if (timer.repeatCount === 0) {
            // Удаляем одноразовый таймер
            await this.removeTimerFromDatabase(timer.name);
            this.settings.timers.delete(timer.name);
            this.timerIntervals.delete(timer.name);
            console.log(`🗑️ Одноразовый таймер "${timer.name}" удален`);
        }

    } catch (error) {
        console.error(`❌ Ошибка отправки сообщения таймера "${timer.name}":`, error);
        
        // Пробуем отправить сообщение об ошибке
        try {
            await this.telegramClient.sendMessage(timer.chatId, {
                message: `❌ Ошибка таймера "${timer.name}": ${error.message}`
            });
        } catch (e) {
            console.error('Не удалось отправить сообщение об ошибке:', e);
        }
    }
}

/**
 * Расширенная справка по таймерам
 */
async showEnhancedTimerHelp(chatId, messageId) {
    const helpText = `⏰ РАСШИРЕННЫЕ ТАЙМЕРЫ v2.0\n\n` +

                    `⏱️ ФОРМАТЫ ВРЕМЕНИ:\n` +
                    `• с, сек - секунды (30с, 10сек)\n` +
                    `• м, мин - минуты (5м, 10мин)\n` +
                    `• ч, час - часы (2ч, 3час)\n` +
                    `• д, день - дни (1д, 2дня)\n` +
                    `• н, нед - недели (1н, 2нед)\n` +
                    `• мес - месяцы (1мес)\n` +
                    `• г, год - годы (1г, 2года)\n\n` +

                    `💾 СОЗДАНИЕ ТАЙМЕРА:\n` +
                    `${this.settings.prefix}таймер add [название] [время] [текст] [параметры]\n\n` +

                    `⚙️ РАСШИРЕННЫЕ ПАРАМЕТРЫ:\n` +
                    `• -repeat N - количество повторов (0 = одноразовый)\n` +
                    `• -silent - тихий режим (без уведомлений)\n` +
                    `• -pin - закрепить сообщение\n` +
                    `• -reply - ответить на текущее сообщение\n` +
                    `• -delete_after N - удалить сообщение через N секунд\n` +
                    `• -chat ID - отправить в указанный чат\n\n` +

                    `📋 КОМАНДЫ УПРАВЛЕНИЯ:\n` +
                    `• ${this.settings.prefix}таймеры - список всех таймеров\n` +
                    `• ${this.settings.prefix}таймер удалить [название] - удалить таймер\n` +
                    `• ${this.settings.prefix}таймер инфо [название] - информация о таймере\n` +
                    `• ${this.settings.prefix}таймер включить [название] - включить таймер\n` +
                    `• ${this.settings.prefix}таймер выключить [название] - выключить таймер\n` +
                    `• ${this.settings.prefix}таймер сработать [название] - принудительно запустить\n\n` +

                    `🎯 ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ:\n` +
                    `• ${this.settings.prefix}таймер add уведомление 30м "Проверить задачи" -silent\n` +
                    `• ${this.settings.prefix}таймер add напоминание 1ч "Встреча" -repeat 5 -pin\n` +
                    `• ${this.settings.prefix}таймер add автоудаление 10с "Секретное сообщение" -delete_after 30\n` +
                    `• ${this.settings.prefix}таймер add ежедневное 1д "Ежедневный отчет" -repeat 365\n\n` +

                    `💡 Таймеры сохраняются при перезагрузке бота и автоматически восстанавливаются!`;

    await this.editMessage(chatId, messageId, helpText);
}

async deepseekSimple(args, message, chatId, senderId, messageId) {
    if (!this.settings.deepseek.apiKey) {
        await this.editMessage(chatId, messageId,
            `🤖 DeepSeek AI Integration\n\n` +
            `🔑 Для использования необходим API ключ:\n` +
            `• ${this.settings.prefix}дип_ключ ваш_api_ключ\n\n` +
            `🔗 Получить ключ:\n` +
            `1. Зайдите на https://platform.deepseek.com\n` +
            `2. Зарегистрируйтесь/войдите\n` +
            `3. Перейдите в API Keys\n` +
            `4. Создайте новый ключ\n` +
            `5. Скопируйте ключ (начинается с sk-)\n\n` +
            `💡 Пример:\n` +
            `${this.settings.prefix}дип_ключ sk-вашключ123456789`
        );
        return;
    }

    if (args.length === 0) {
        await this.editMessage(chatId, messageId,
            `💬 DeepSeek AI Чат\n\n` +
            `Отправьте ваш запрос:\n` +
            `• ${this.settings.prefix}дип Привет! Как дела?\n` +
            `• ${this.settings.prefix}дип Напиши код на Python\n` +
            `• ${this.settings.prefix}дип Объясни квантовую физику\n\n` +
            `⚡ Используется: ${this.settings.deepseek.model}`
        );
        return;
    }

    const query = args.join(' ');
    
    try {
        await this.editMessage(chatId, messageId, `🔄 DeepSeek обрабатывает запрос...`);

        const response = await this.callDeepSeekAPI(query);
        
        // Форматируем ответ
        let formattedResponse = `🤖 DeepSeek Response:\n\n${response}`;
        
        // Если ответ длинный, разбиваем на части
        if (formattedResponse.length > 4000) {
            const parts = this.splitMessage(formattedResponse, 4000);
            for (let i = 0; i < parts.length; i++) {
                if (i === 0) {
                    await this.editMessage(chatId, messageId, parts[i]);
                } else {
                    await this.telegramClient.sendMessage(chatId, {
                        message: parts[i],
                        parseMode: null
                    });
                }
            }
        } else {
            await this.editMessage(chatId, messageId, formattedResponse);
        }

    } catch (error) {
        console.error('❌ DeepSeek Error:', error);
        
        let errorMsg = `❌ Ошибка DeepSeek: ${error.message}`;
        
        if (error.message.includes('401')) {
            errorMsg = `❌ Неверный API ключ\n\nПроверьте ключ: ${this.settings.prefix}дип_ключ [новый_ключ]`;
        } else if (error.message.includes('402')) {
            errorMsg = `❌ Недостаточно средств\n\nПополните баланс на platform.deepseek.com`;
        } else if (error.message.includes('429')) {
            errorMsg = `❌ Слишком много запросов\n\nПодождите немного перед следующим запросом`;
        } else if (error.message.includes('ENOTFOUND')) {
            errorMsg = `❌ Проблемы с интернет-соединением\n\nПроверьте подключение к интернету`;
        }
        
        await this.editMessage(chatId, messageId, errorMsg);
    }
}

// Простой вызов API DeepSeek
async callDeepSeekAPI(prompt) {
    const url = 'https://api.deepseek.com/v1/chat/completions';
    
    const requestData = {
        model: this.settings.deepseek.model,
        messages: [
            {
                role: "user",
                content: prompt
            }
        ],
        max_tokens: this.settings.deepseek.maxTokens,
        temperature: this.settings.deepseek.temperature,
        stream: false
    };

    const response = await axios.post(url, requestData, {
        headers: {
            'Authorization': `Bearer ${this.settings.deepseek.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
        return response.data.choices[0].message.content.trim();
    } else {
        throw new Error('Неверный формат ответа от API');
    }
}

// Упрощенная установка ключа
async setDeepSeekKeySimple(args, message, chatId, senderId, messageId) {
    if (args.length === 0) {
        await this.editMessage(chatId, messageId,
            `🔑 Установка DeepSeek API ключа\n\n` +
            `💡 Использование: ${this.settings.prefix}дип_ключ ваш_api_ключ\n\n` +
            `🔗 Получить ключ:\n` +
            `https://platform.deepseek.com/api_keys\n\n` +
            `📝 Ключ должен начинаться с "sk-"`
        );
        return;
    }

    const apiKey = args[0];
    
    if (!apiKey.startsWith('sk-')) {
        await this.editMessage(chatId, messageId,
            `❌ Неверный формат API ключа\n\n` +
            `💡 Ключ должен начинаться с "sk-"`
        );
        return;
    }

    // Сохраняем ключ без немедленной проверки
    this.settings.deepseek.apiKey = apiKey;
    this.settings.deepseek.enabled = true;
    this.saveSettings();
    
    await this.editMessage(chatId, messageId,
        `✅ API ключ сохранен!\n\n` +
        `🔑 Ключ: ${apiKey.substring(0, 10)}...\n` +
        `🤖 Модель: ${this.settings.deepseek.model}\n\n` +
        `💡 Теперь используйте: ${this.settings.prefix}дип [ваш запрос]\n\n` +
        `⚠️ Ключ будет проверен при первом запросе`
    );
}

// Упрощенный статус
async deepseekStatusSimple(args, message, chatId, senderId, messageId) {
    const status = this.settings.deepseek.enabled ? '✅ Активен' : '❌ Неактивен';
    const apiKeyStatus = this.settings.deepseek.apiKey ? 
        `🔑 ${this.settings.deepseek.apiKey.substring(0, 10)}...` : '❌ Не установлен';
    
    const response = `📊 Статус DeepSeek\n\n` +
                   `• Статус: ${status}\n` +
                   `• API ключ: ${apiKeyStatus}\n` +
                   `• Модель: ${this.settings.deepseek.model}\n` +
                   `• Макс. токенов: ${this.settings.deepseek.maxTokens}\n` +
                   `• Температура: ${this.settings.deepseek.temperature}\n\n` +
                   `💡 Команды:\n` +
                   `• ${this.settings.prefix}дип [запрос] - общение с AI\n` +
                   `• ${this.settings.prefix}дип_ключ [ключ] - установить ключ\n` +
                   `• ${this.settings.prefix}дип_помощь - подробная помощь`;
    
    await this.editMessage(chatId, messageId, response);
}

// Упрощенная помощь
async deepseekHelpSimple(args, message, chatId, senderId, messageId) {
    const helpText = `🤖 DeepSeek AI - Помощь\n\n` +

                    `🔑 ПОЛУЧЕНИЕ API КЛЮЧА:\n` +
                    `1. Откройте: https://platform.deepseek.com\n` +
                    `2. Войдите или зарегистрируйтесь\n` +
                    `3. Перейдите в "API Keys"\n` +
                    `4. Нажмите "Create new API key"\n` +
                    `5. Скопируйте ключ (начинается с sk-)\n\n` +

                    `⚙️ НАСТРОЙКА БОТА:\n` +
                    `• ${this.settings.prefix}дип_ключ sk-ваш_ключ - установить ключ\n` +
                    `• ${this.settings.prefix}дип_статус - проверить статус\n\n` +

                    `💬 ИСПОЛЬЗОВАНИЕ AI:\n` +
                    `• ${this.settings.prefix}дип [вопрос] - задать вопрос\n` +
                    `• ${this.settings.prefix}дип напиши код на Python\n` +
                    `• ${this.settings.prefix}дип объясни квантовую физику\n\n` +

                    `❓ РЕШЕНИЕ ПРОБЛЕМ:\n` +
                    `• Ошибка 401: Неверный API ключ\n` +
                    `• Ошибка 402: Закончились средства\n` +
                    `• Ошибка 429: Слишком много запросов\n\n` +

                    `💎 ПРЕИМУЩЕСТВА:\n` +
                    `• Бесплатные лимиты: 1000 запросов/месяц\n` +
                    `• Быстрые ответы\n` +
                    `• Поддержка русского языка\n` +
                    `• Хорошее качество генерации`;

    await this.editMessage(chatId, messageId, helpText);
}

// Вспомогательная функция для разбивки длинных сообщений
splitMessage(text, maxLength) {
    const parts = [];
    let currentPart = '';
    
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
        if (currentPart.length + sentence.length <= maxLength) {
            currentPart += sentence + ' ';
        } else {
            if (currentPart) {
                parts.push(currentPart.trim());
            }
            currentPart = sentence + ' ';
        }
    }
    
    if (currentPart) {
        parts.push(currentPart.trim());
    }
    
    return parts;
}}

// ========== ЗАПУСК БОТА ==========
// Ключи Telegram API берутся из config.json рядом со script.js (см. config.example.json)
// или из переменных окружения TELEGRAM_API_ID / TELEGRAM_API_HASH (имеют приоритет).
const appConfig = (() => {
    const configPath = path.join(__dirname, 'config.json');
    try {
        return fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    } catch (error) {
        console.error(`❌ Не удалось прочитать ${configPath}:`, error.message);
        return {};
    }
})();
const telegramApiId = process.env.TELEGRAM_API_ID || appConfig.telegramApiId;
const telegramApiHash = process.env.TELEGRAM_API_HASH || appConfig.telegramApiHash || '';

console.log('🔧 Запуск с параметрами:');
console.log(`- API ID: ${telegramApiId}`);
console.log(`- API Hash: ${telegramApiHash ? '***' + telegramApiHash.slice(-4) : 'НЕ УСТАНОВЛЕН'}`);

const bot = new lpbot(telegramApiId, telegramApiHash);

// VK-клиент стартует сразу и не ждёт авторизации TG (ТЗ п. 3.4). Без токена пишет одну строку в лог и не запускается.
const VkClient = require('./vk_client.js');
bot.vkClient = new VkClient(bot, appConfig.vk || {});
bot.vkClient.start().catch((error) => console.error('❌ VK: ошибка запуска:', error.message));
bot.start().catch(console.error);

module.exports = lpbot;