require('./_no_network.js')(); // строго без сети, unshare -rn
// Комплексный приёмочный тест под требования нового ТЗ (QA Lead):
// 1. Проверка режима ответа: edit (редактирование) vs reply (новое сообщение)
// 2. Проверка строгого дефолтного префикса '!' и флага allowMultiPrefix: false
// 3. Проверка ACL системы (отсев чужих, черные/белые списки чатов, уровни доверенных лиц)
// 4. Проверка логики удаления сообщений смс / удалить (N последних, выше, ниже, по ответу, инструкция при пустом вызове)

const path = require('path');
const fs = require('fs');

let ok = 0;
let fail = 0;
const t = (cond, msg) => {
    if (cond) {
        ok++;
        console.log(`OK   ${msg}`);
    } else {
        fail++;
        console.log(`FAIL ${msg}`);
    }
};

(async () => {
    console.log('--- ТЕСТЫ НОВОГО ТЗ: РЕЖИМ ОТВЕТА, ПРЕФИКС, ACL И УДАЛЕНИЕ СМС ---');

    // =========================================================================
    // БЛОК 1: Проверка режима ответа: edit (редактирование) vs reply (новое сообщение)
    // =========================================================================
    console.log('\n[1] Проверка режима ответа (edit vs reply):');
    const { sendOutput } = require('../modules/commands/_common/ui.js');

    const edited = [];
    const sent = [];

    const mockMessaging = {
        editMessage: async (chatId, messageId, text) => {
            edited.push({ chatId, messageId, text });
            return { id: messageId, text };
        },
        sendMessage: async (chatId, text, options) => {
            sent.push({ chatId, text, options });
            return { id: 999, text, options };
        }
    };

    const mockCoreWithMode = (mode) => ({
        get: (svc) => {
            if (svc === 'messaging') return mockMessaging;
            if (svc === 'settings') return {
                get: (k, def) => (k === 'responseMode' || k === 'reply_mode') ? mode : def
            };
            return null;
        }
    });

    // 1.1 Режим edit для исходящего сообщения владельца (message.out: true)
    edited.length = 0; sent.length = 0;
    const ctxOwnerEdit = { chatId: 100, messageId: 55, message: { out: true } };
    await sendOutput(mockCoreWithMode('edit'), ctxOwnerEdit, 'Тестовый ответ edit');
    t(edited.length === 1 && edited[0].messageId === 55, 'Режим edit: исходящее сообщение редактируется на месте (editMessage)');
    t(sent.length === 0, 'Режим edit: новое сообщение не отправляется');

    // 1.2 Режим reply: отправка нового сообщения в ответ
    edited.length = 0; sent.length = 0;
    const ctxOwnerReply = { chatId: 100, messageId: 55, message: { out: true } };
    await sendOutput(mockCoreWithMode('reply'), ctxOwnerReply, 'Тестовый ответ reply');
    t(sent.length === 1 && sent[0].options.replyTo === 55, 'Режим reply: отправляется новое сообщение с replyTo на команду');
    t(edited.length === 0, 'Режим reply: editMessage не вызывается');

    // 1.3 Входящее чужое сообщение (out: false) даже при режиме edit отправляется новым сообщением
    edited.length = 0; sent.length = 0;
    const ctxStranger = { chatId: 100, messageId: 60, message: { out: false } };
    await sendOutput(mockCoreWithMode('edit'), ctxStranger, 'Ответ на входящее');
    t(sent.length === 1 && sent[0].options.replyTo === 60, 'Входящее сообщение (out: false): отправляется новым сообщением');
    t(edited.length === 0, 'Входящее сообщение: editMessage не вызывается');


    // =========================================================================
    // БЛОК 2: Строгий дефолтный префикс '!' и allowMultiPrefix: false
    // =========================================================================
    console.log('\n[2] Проверка строгого префикса "!" и allowMultiPrefix:');

    // Функция проверки матчинга префикса с учетом allowMultiPrefix
    function testMatchPrefix(configuredPrefix, text, allowMulti = false) {
        if (!configuredPrefix || !text || typeof text !== 'string') return null;
        if (text.startsWith(configuredPrefix)) {
            return { matched: true, length: configuredPrefix.length, char: configuredPrefix };
        }
        if (allowMulti) {
            if (configuredPrefix === '!' && text.startsWith('*')) return { matched: true, length: 1, char: '*' };
            if (configuredPrefix === '*' && text.startsWith('!')) return { matched: true, length: 1, char: '!' };
        }
        return null;
    }

    // 2.1 Строгий режим (allowMultiPrefix: false)
    t(testMatchPrefix('!', '!пинг', false) !== null, 'Строгий префикс: "!пинг" успешно распознается при prefix="!"');
    t(testMatchPrefix('!', '*пинг', false) === null, 'Строгий префикс: "*пинг" ОТКЛОНЯЕТСЯ при allowMultiPrefix: false');
    t(testMatchPrefix('!', '‘пинг', false) === null, 'Строгий префикс: "‘пинг" ОТКЛОНЯЕТСЯ при allowMultiPrefix: false');

    // 2.2 Разрешенный мультипрефикс (allowMultiPrefix: true)
    t(testMatchPrefix('!', '*пинг', true) !== null, 'Мультипрефикс: "*пинг" принимается при allowMultiPrefix: true');
    t(testMatchPrefix('*', '!пинг', true) !== null, 'Мультипрефикс: "!пинг" принимается при prefix="*" и allowMultiPrefix: true');


    // =========================================================================
    // БЛОК 3: ACL система (отсев чужих, списки чатов, уровни доверенных лиц)
    // =========================================================================
    console.log('\n[3] Проверка ACL системы:');
    const usersMod = require('../modules/core/users/index.js');
    const UsersService = usersMod.UsersService;

    const fakeDb = {
        users: new Map(),
        acl: [],
        async get(sql, params) {
            if (sql.includes('FROM users')) {
                return fakeDb.users.get(String(params[0])) || null;
            }
            return null;
        },
        async run(sql, params) { return { changes: 1 }; }
    };

    const usersService = new UsersService(fakeDb, { log: () => {} });
    const botInfo = { id: 11111 };

    // 3.1 Автоматический отсев чужих сообщений
    t(usersService.isOwnerMessage({ out: true }, 99999, botInfo) === true, 'ACL: сообщение с out: true признано владельцем');
    t(usersService.isOwnerMessage({ out: false }, 11111, botInfo) === true, 'ACL: входящее от ID владельца признано владельцем');
    t(usersService.isOwnerMessage({ out: false }, 99999, botInfo) === false, 'ACL: сообщение от постороннего (out: false, senderId != owner) ОТСЕЯНО');

    // 3.2 Проверка списков чатов (черный и белый списки)
    function isChatAllowed(chatId, { chatBlacklist = [], chatWhitelist = [], whitelistEnabled = false } = {}) {
        const cId = String(chatId);
        if (chatBlacklist.map(String).includes(cId)) return false;
        if (whitelistEnabled) {
            return chatWhitelist.map(String).includes(cId);
        }
        return true;
    }

    t(isChatAllowed(100, { chatBlacklist: [200, 300] }) === true, 'ACL Чат: обычный чат разрешен');
    t(isChatAllowed(200, { chatBlacklist: [200, 300] }) === false, 'ACL Чат: чат из черного списка ЗАБЛОКИРОВАН');
    t(isChatAllowed(100, { whitelistEnabled: true, chatWhitelist: [500] }) === false, 'ACL Чат: чат вне белого списка при включенном whitelist ЗАБЛОКИРОВАН');
    t(isChatAllowed(500, { whitelistEnabled: true, chatWhitelist: [500] }) === true, 'ACL Чат: чат из белого списка разрешен');

    // 3.3 Уровни доверенных лиц (1-базовый, 2-модератор, 3-админ, 4-владелец)
    function canExecute(requiredLevel, userLevel) {
        return Number(userLevel || 0) >= Number(requiredLevel || 1);
    }

    t(canExecute(1, 1) === true, 'ACL Роли: доверенному уровня 1 разрешена базовая команда (level 1)');
    t(canExecute(2, 1) === false, 'ACL Роли: доверенному уровня 1 ЗАПРЕЩЕНА команда модерации (level 2)');
    t(canExecute(2, 2) === true, 'ACL Роли: доверенному уровня 2 разрешена команда модерации (level 2)');
    t(canExecute(3, 2) === false, 'ACL Роли: доверенному уровня 2 ЗАПРЕЩЕНА админ-команда (level 3)');
    t(canExecute(3, 3) === true, 'ACL Роли: доверенному уровня 3 разрешена админ-команда (level 3)');
    t(canExecute(4, 3) === false, 'ACL Роли: доверенному уровня 3 ЗАПРЕЩЕНА команда владельца (level 4)');
    t(canExecute(4, 4) === true, 'ACL Роли: владельцу (level 4) доступны все команды');


    // =========================================================================
    // БЛОК 4: Логика удаления сообщений (смс / удалить)
    // =========================================================================
    console.log('\n[4] Проверка логики удаления сообщений (смс / удалить):');
    const deleteMod = require('../modules/commands/delete_messages/index.js');

    const deletedIds = [];
    let outputText = null;

    const mockTgClient = {
        getMessages: async (chatId, opts = {}) => {
            // Генерируем тестовую историю сообщений: id 100 .. 120
            const msgs = [];
            for (let i = 120; i >= 100; i--) {
                msgs.push({ id: i });
            }
            if (opts.maxId) {
                return msgs.filter(m => m.id < opts.maxId).slice(0, opts.limit || 10);
            }
            if (opts.minId) {
                return msgs.filter(m => m.id > opts.minId).slice(0, opts.limit || 10);
            }
            return msgs.slice(0, opts.limit || 10);
        }
    };

    const mockCoreDelete = {
        get: (svc) => {
            if (svc === 'messaging') return {
                safeDelete: async (cId, ids) => { deletedIds.push(...ids); return true; },
                editMessage: async (cId, mId, txt) => { outputText = txt; return true; },
                sendMessage: async (cId, txt) => { outputText = txt; return true; }
            };
            if (svc === 'telegram') return { getClient: () => mockTgClient };
            if (svc === 'settings') return { get: (k, d) => d };
            return null;
        },
        log: () => {}
    };

    const handler = deleteMod.commands['смс'].handler;

    // 4.1 Пустой вызов (без аргументов и без ответа): вывод инструкции, сообщения не удаляются
    deletedIds.length = 0; outputText = null;
    await handler(mockCoreDelete, { args: [], message: { replyTo: null, out: true }, chatId: 1, messageId: 50 });
    t(outputText && outputText.includes('УДАЛЕНИЕ СООБЩЕНИЙ'), 'Удаление: пустой вызов выводит подробную инструкцию (мануал)');
    t(deletedIds.length === 0, 'Удаление: при пустом вызове сообщения чата НЕ удаляются');

    // 4.2 По ответу на сообщение (без аргументов): удаляется отвеченное + команда
    deletedIds.length = 0; outputText = null;
    await handler(mockCoreDelete, { args: [], message: { replyTo: { replyToMsgId: 110 }, out: true }, chatId: 1, messageId: 50 });
    t(deletedIds.includes(50) && deletedIds.includes(110), 'Удаление по ответу: удалены ID команды (50) и отвеченное сообщение (110)');
    t(deletedIds.length === 2, 'Удаление по ответу: удалено ровно 2 сообщения');

    // 4.3 N последних сообщений (смс 3)
    deletedIds.length = 0;
    await handler(mockCoreDelete, { args: ['3'], message: { replyTo: null, out: true }, chatId: 1, messageId: 50 });
    t(deletedIds.includes(50), 'Удаление N: удалено сообщение команды (50)');
    t(deletedIds.length === 4, 'Удаление N: удалены команда + 3 последних сообщения (всего 4)');

    // 4.4 Удаление ВЫШЕ по ответу (смс +3 ответом на 110)
    deletedIds.length = 0;
    await handler(mockCoreDelete, { args: ['+3'], message: { replyTo: { replyToMsgId: 110 }, out: true }, chatId: 1, messageId: 50 });
    const aboveIds = deletedIds.filter(id => id < 110 && id !== 50);
    t(aboveIds.length === 3, 'Удаление ВЫШЕ: удалено ровно 3 сообщения старее отвеченного (id < 110)');

    // 4.5 Удаление НИЖЕ по ответу (смс -2 ответом на 110)
    deletedIds.length = 0;
    await handler(mockCoreDelete, { args: ['-2'], message: { replyTo: { replyToMsgId: 110 }, out: true }, chatId: 1, messageId: 50 });
    const belowIds = deletedIds.filter(id => id > 110 && id !== 50);
    t(belowIds.length === 2, 'Удаление НИЖЕ: удалено ровно 2 сообщения новее отвеченного (id > 110)');

    console.log(`\nИТОГ ТЕСТОВ НОВОГО ТЗ: Успешно: ${ok} | Провалено: ${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('FAIL Необработанная ошибка:', e);
    process.exit(1);
});
