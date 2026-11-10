require('./_no_network.js')(); // строго без сети, unshare -rn
// Тест безопасности подсистемы контроля доступа (ACL) и фильтрации чатов
// Проверяет: Silent Drop, BigInt-защиту, Chat Blacklist/Whitelist, RBAC-уровни 0..4

const assert = require('assert/strict');
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
    console.log('=== ТЕСТЫ БЕЗОПАСНОСТИ: ПОДСИСТЕМА КОНТРОЛЯ ДОСТУПА (ACL) ===\n');

    const usersMod = require('../modules/core/users/index.js');
    const UsersService = usersMod.UsersService;

    // Создаем фиктивную БД для изоляции
    const fakeAcl = [];
    const fakeUsers = new Map();

    const fakeDb = {
        async getAclRules() {
            return [...fakeAcl];
        },
        async addAclRule(targetType, targetId, ruleType, accessLevel = 1) {
            const cleanId = String(targetId).trim();
            const existing = fakeAcl.find(r => r.target_type === targetType && r.target_id === cleanId && r.rule_type === ruleType);
            if (existing) {
                existing.access_level = accessLevel;
            } else {
                fakeAcl.push({ target_type: targetType, target_id: cleanId, rule_type: ruleType, access_level: accessLevel });
            }
            return { changes: 1 };
        },
        async removeAclRule(targetType, targetId, ruleType) {
            const cleanId = String(targetId).trim();
            const idx = fakeAcl.findIndex(r => r.target_type === targetType && r.target_id === cleanId && r.rule_type === ruleType);
            if (idx >= 0) fakeAcl.splice(idx, 1);
            return { changes: 1 };
        },
        async checkAccess(targetType, targetId, ruleType) {
            const cleanId = String(targetId).trim();
            return fakeAcl.find(r => r.target_type === targetType && r.target_id === cleanId && r.rule_type === ruleType) || null;
        },
        async run(sql, params) {
            if (sql.includes('DELETE FROM acl')) {
                if (sql.includes('rule_type')) {
                    const match = sql.match(/rule_type = '(\w+)'/);
                    const type = match ? match[1] : null;
                    const before = fakeAcl.length;
                    for (let i = fakeAcl.length - 1; i >= 0; i--) {
                        if (fakeAcl[i].rule_type === type) fakeAcl.splice(i, 1);
                    }
                    return { changes: before - fakeAcl.length };
                }
                fakeAcl.length = 0;
            }
            return { changes: 1 };
        },
        async get(sql, params) {
            if (sql.includes('FROM users WHERE tg_id = ?')) {
                return fakeUsers.get(String(params[0])) || null;
            }
            return null;
        }
    };

    const users = new UsersService(fakeDb, { log: () => {} });
    await users.loadAclCache();

    // 1. Нормализация BigInt ID и защита от переполнения
    console.log('[1] Защита от переполнения BigInt (> 2^53 - 1):');
    const bigOwnerId = 9007199254740993n; // 2^53 + 1, где Number() теряет точность
    const bigStrangerId = 9007199254740995n;

    const botInfo = { id: bigOwnerId };
    t(users.normalizeTgId(bigOwnerId) === '9007199254740993', 'normalizeTgId: BigInt корректно преобразуется в строку без потери точности');
    t(users.isOwnerMessage({ out: false }, bigOwnerId, botInfo) === true, 'isOwnerMessage: входящее от собственного BigInt ID авторизовано');
    t(users.isOwnerMessage({ out: false }, bigStrangerId, botInfo) === false, 'isOwnerMessage: посторонний BigInt ID строго отвергнут');
    t(users.isOwnerMessage({ out: true }, bigStrangerId, botInfo) === true, 'isOwnerMessage: исходящее (out: true) всегда авторизовано');

    // 2. Черный список чатов (Chat Blacklist - Absolute Mute)
    console.log('\n[2] Черный список чатов (Chat Blacklist):');
    const secretChatId = '-1001234567890';
    const normalChatId = '-1009876543210';

    t(users.isChatBlocked(secretChatId) === false, 'До блокировки: чат не заблокирован');
    await users.addBlacklistChat(secretChatId);
    t(users.isChatBlocked(secretChatId) === true, 'После добавления в ЧС: чат ЗАГЛУШЕН (isChatBlocked: true)');
    t(users.isChatBlocked(normalChatId) === false, 'Обычный чат остается разблокированным');

    const blList = users.getBlacklistChats();
    t(blList.includes(secretChatId), 'getBlacklistChats: содержит заблокированный чат');

    await users.removeBlacklistChat(secretChatId);
    t(users.isChatBlocked(secretChatId) === false, 'После удаления из ЧС: чат снова РАЗБЛОКИРОВАН');

    // 3. Белый список чатов (Strict Whitelist)
    console.log('\n[3] Белый список чатов (Chat Whitelist):');
    const allowedChat1 = '2000000001';
    const allowedChat2 = '2000000002';
    const unknownChat = '2000000099';

    t(users.isChatBlocked(unknownChat) === false, 'При пустом белом списке: неизвестный чат разрешен');
    await users.addWhitelistChat(allowedChat1);
    await users.addWhitelistChat(allowedChat2);

    t(users.isChatBlocked(allowedChat1) === false, 'Чат из белого списка: разрешен');
    t(users.isChatBlocked(allowedChat2) === false, 'Второй чат из белого списка: разрешен');
    t(users.isChatBlocked(unknownChat) === true, 'Чат ВНЕ белого списка при активном whitelist: ЗАБЛОКИРОВАН');

    await users.clearWhitelistChats();
    t(users.isChatBlocked(unknownChat) === false, 'После очистки белого списка: фильтрация выключена, чат снова разрешен');

    // 4. Ролевой доступ RBAC (Уровни 0..4)
    console.log('\n[4] Ролевая модель доступа (RBAC 0..4):');
    const guestId = '111222333';
    const trustedId = '444555666';
    const moderatorId = '777888999';

    // 4.1 Guest (Уровень 0)
    t(await users.getUserAccessLevel(guestId, botInfo) === 0, 'Посторонний пользователь по умолчанию имеет уровень 0 (Guest)');
    t(await users.canUserExecute('пинг', guestId, botInfo) === false, 'Guest (lvl 0): ЗАПРЕЩЕН вызов !пинг (Silent Drop)');
    t(await users.canUserExecute('код', guestId, botInfo) === false, 'Guest (lvl 0): ЗАПРЕЩЕН вызов !код');

    // 4.2 Делегирование прав: Trusted (Уровень 1)
    await users.setUserAccessLevel(trustedId, 1);
    t(await users.getUserAccessLevel(trustedId, botInfo) === 1, 'Доверенному пользователю установлен уровень 1');
    t(await users.canUserExecute('пинг', trustedId, botInfo) === true, 'Trusted (lvl 1): РАЗРЕШЕН !пинг');
    t(await users.canUserExecute('о_чате', trustedId, botInfo) === true, 'Trusted (lvl 1): РАЗРЕШЕН !о_чате');
    t(await users.canUserExecute('айди', trustedId, botInfo) === true, 'Trusted (lvl 1): РАЗРЕШЕН !айди');
    t(await users.canUserExecute('смс', trustedId, botInfo) === false, 'Trusted (lvl 1): ЗАПРЕЩЕНО удаление сообщений (!смс)');
    t(await users.canUserExecute('закреп', trustedId, botInfo) === false, 'Trusted (lvl 1): ЗАПРЕЩЕНО закрепление (!закреп)');
    t(await users.canUserExecute('код', trustedId, botInfo) === false, 'Trusted (lvl 1): ЗАПРЕЩЕНО управление кодом (!код)');

    // 4.3 Делегирование прав: Moderator (Уровень 2)
    await users.setUserAccessLevel(moderatorId, 2);
    t(await users.getUserAccessLevel(moderatorId, botInfo) === 2, 'Модератору установлен уровень 2');
    t(await users.canUserExecute('пинг', moderatorId, botInfo) === true, 'Moderator (lvl 2): РАЗРЕШЕН !пинг');
    t(await users.canUserExecute('смс', moderatorId, botInfo) === true, 'Moderator (lvl 2): РАЗРЕШЕНО удаление !смс');
    t(await users.canUserExecute('закреп', moderatorId, botInfo) === true, 'Moderator (lvl 2): РАЗРЕШЕНО закрепление !закреп');
    t(await users.canUserExecute('код', moderatorId, botInfo) === false, 'Moderator (lvl 2): СТРОГО ЗАПРЕЩЕНО управление кодом (!код)');
    t(await users.canUserExecute('префикс', moderatorId, botInfo) === false, 'Moderator (lvl 2): ЗАПРЕЩЕНА смена префикса');
    t(await users.canUserExecute('доверить', moderatorId, botInfo) === false, 'Moderator (lvl 2): ЗАПРЕЩЕНО делегирование прав');

    // 4.4 Владелец (Уровень 4)
    t(await users.getUserAccessLevel(bigOwnerId, botInfo) === 4, 'Владелец бота имеет уровень 4 (Owner)');
    t(await users.canUserExecute('код', bigOwnerId, botInfo) === true, 'Owner (lvl 4): РАЗРЕШЕНО управление кодом');
    t(await users.canUserExecute('префикс', bigOwnerId, botInfo) === true, 'Owner (lvl 4): РАЗРЕШЕНА смена префикса');
    t(await users.canUserExecute('доверить', bigOwnerId, botInfo) === true, 'Owner (lvl 4): РАЗРЕШЕНО управление доступом');
    t(await users.canUserExecute('чс_чат', bigOwnerId, botInfo) === true, 'Owner (lvl 4): РАЗРЕШЕНО управление фильтрами чатов');

    // 4.5 Отзыв прав
    await users.setUserAccessLevel(trustedId, 0);
    t(await users.getUserAccessLevel(trustedId, botInfo) === 0, 'После отзыва прав: уровень сброшен в 0 (Guest)');
    t(await users.canUserExecute('пинг', trustedId, botInfo) === false, 'После отзыва: !пинг снова заблокирован');

    // 5. Проверка интеграции в script.js (класс lpbot)
    console.log('\n[5] Проверка интеграции гварда в script.js:');
    const scriptSrc = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    t(scriptSrc.includes('isChatBlocked(chatId)'), 'script.js: проверка isChatBlocked встроена в начало обработчика');
    t(scriptSrc.includes('Silent Drop: отклонен вызов команды'), 'script.js: реализован Silent Drop для неавторизованных пользователей');
    t(scriptSrc.includes('this.commands = {'), 'script.js: базовый реестр setupCommands сохранен для совместимости');
    t(scriptSrc.includes("'чс_чат': this.manageChatBlacklist.bind(this)"), 'script.js: команда чс_чат зарегистрирована в commands');
    t(scriptSrc.includes("'бс_чат': this.manageChatWhitelist.bind(this)"), 'script.js: команда бс_чат зарегистрирована в commands');
    t(scriptSrc.includes("'доверить': this.trustUserCommand.bind(this)"), 'script.js: команда доверить зарегистрирована в commands');
    t(scriptSrc.includes("'отозвать': this.revokeUserCommand.bind(this)"), 'script.js: команда отозвать зарегистрирована в commands');
    t(scriptSrc.includes("'доступ': this.checkUserAccessCommand.bind(this)"), 'script.js: команда доступ зарегистрирована в commands');

    console.log('\n-------------------------------------------------------------');
    console.log(`ИТОГИ: Успешно: ${ok} | Провалов: ${fail}`);
    console.log('-------------------------------------------------------------');

    if (fail > 0) {
        console.error('❌ ТЕСТЫ БЕЗОПАСНОСТИ ACL ПРОВАЛЕНЫ!');
        process.exit(1);
    } else {
        console.log('✅ ВСЕ ПРОВЕРКИ БЕЗОПАСНОСТИ ACL УСПЕШНО ПРОЙДЕНЫ!');
        process.exit(0);
    }
})().catch(e => {
    console.error('FAIL Неожиданное исключение:', e);
    process.exit(1);
});
