require('./_no_network.js')();
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCore } = require('../main.js');
const dbModule = require('../modules/core/db/index.js');

async function runTests() {
    console.log('🧪 Запуск тестов модуля службы базы данных modules/core/db (P0 Refactor)...\n');

    // 1. Проверка контракта модуля
    console.log('1. Проверка контракта docs/modules.md...');
    assert.equal(dbModule.name, 'db');
    assert.equal(dbModule.version, '1.0.0');
    assert.equal(dbModule.engine, '^1.0.0');
    assert.deepEqual(dbModule.requires, []);
    assert.equal(typeof dbModule.init, 'function');
    assert.equal(typeof dbModule.stop, 'function');
    assert.equal(typeof dbModule.open, 'function');
    console.log('✅ Контракт модуля полностью соответствует спецификации.');

    // Временная директория для изолированной тестовой базы
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-db-'));
    const testDbPath = path.join(tempDir, 'test_database.sqlite');

    try {
        // 2. Инициализация через ядро
        console.log('\n2. Инициализация службы через ядро createCore()...');
        const core = createCore({ logger: () => {} });
        core.options = { dbPath: testDbPath };

        await dbModule.init(core);

        const db = core.get('db');
        assert(db, 'Служба db должна быть зарегистрирована в ядре');
        assert.equal(typeof db.run, 'function');
        assert.equal(typeof db.get, 'function');
        assert.equal(typeof db.all, 'function');
        assert.equal(typeof db.transaction, 'function');
        console.log('✅ Служба db успешно инициализирована и зарегистрирована в ядре.');

        // 3. Проверка PRAGMA
        console.log('\n3. Проверка PRAGMA параметров соединения...');
        const fk = await db.get('PRAGMA foreign_keys');
        assert.equal(fk.foreign_keys, 1, 'foreign_keys должен быть включен (1)');

        const busy = await db.get('PRAGMA busy_timeout');
        assert.equal(busy.timeout, 5000, 'busy_timeout должен быть равен 5000 мс');

        const journal = await db.get('PRAGMA journal_mode');
        assert.equal(journal.journal_mode.toLowerCase(), 'wal', 'journal_mode должен быть wal');
        console.log('✅ PRAGMA настройки: WAL, busy_timeout=5000, foreign_keys=1 подтверждены.');

        // 4. Проверка схем и таблиц P0
        console.log('\n4. Проверка создания чистых таблиц (P0)...');
        const tables = (await db.all("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name);
        const requiredTables = [
            'users', 'access_levels', 'user_stats', 'command_history',
            'notes', 'acl', 'triggers', 'templates', 'timers',
            'vk_state', '_corrupted_users_backup', 'schema_migrations'
        ];
        for (const reqTable of requiredTables) {
            assert(tables.includes(reqTable), `Таблица ${reqTable} должна существовать в БД`);
        }
        assert(!tables.includes('photo_boost_stats'), 'Таблица photo_boost_stats должна быть удалена!');
        assert(!tables.includes('casino'), 'Таблица casino должна быть удалена!');
        assert(!tables.includes('rpg'), 'Таблица rpg должна быть удалена!');

        console.log(`✅ Схема P0 чистая: legacy таблицы удалены, новые сущности (notes, acl) созданы.`);

        // 5. Тестирование CRUD для notes (заметки)
        console.log('\n5. Тестирование CRUD для notes (заметки)...');
        await db.saveNote('правила', 'Текст правил сообщества');
        await db.saveNote('ссылки', 'https://example.com');

        let note = await db.getNote('правила');
        assert(note);
        assert.equal(note.name, 'правила');
        assert.equal(note.content, 'Текст правил сообщества');

        // Case-insensitivity и trim
        note = await db.getNote('  ПРАВИЛА  ');
        assert(note);
        assert.equal(note.content, 'Текст правил сообщества');

        // UPSERT заметки с обновлением
        await db.saveNote('правила', 'Обновленный текст правил');
        note = await db.getNote('правила');
        assert.equal(note.content, 'Обновленный текст правил');

        // Список заметок
        const notesList = await db.listNotes();
        assert.equal(notesList.length, 2);

        // Удаление заметки
        await db.deleteNote('ссылки');
        assert.equal(await db.getNote('ссылки'), null);
        console.log('✅ CRUD для notes протестирован: get, save (UPSERT), list, delete работают корректно.');

        // 6. Тестирование CRUD для acl (контроль доступа и фильтрация)
        console.log('\n6. Тестирование CRUD для acl (контроль доступа)...');
        // Добавление правил
        await db.addAclRule('chat', '2000000001', 'whitelist', 1);
        await db.addAclRule('user', '123456789', 'blacklist', 1);
        await db.addAclRule('user', '987654321', 'trusted', 3);

        let chatRule = await db.checkAccess('chat', '2000000001', 'whitelist');
        assert(chatRule);
        assert.equal(chatRule.access_level, 1);

        let userBlacklist = await db.checkAccess('user', '123456789', 'blacklist');
        assert(userBlacklist);

        // Обновление access_level через UPSERT
        await db.addAclRule('user', '987654321', 'trusted', 2);
        let trustedUser = await db.checkAccess('user', '987654321', 'trusted');
        assert.equal(trustedUser.access_level, 2);

        // Валидация входных данных на уровне API
        await assert.rejects(async () => {
            await db.addAclRule('invalid_type', '123', 'whitelist');
        }, /Invalid target_type/);

        await assert.rejects(async () => {
            await db.addAclRule('chat', '123', 'invalid_rule');
        }, /Invalid rule_type/);

        // Валидация SQLite CHECK constraint на уровне DDL
        await assert.rejects(async () => {
            await db.run("INSERT INTO acl (target_type, target_id, rule_type) VALUES ('bad', '1', 'whitelist')");
        }, /CHECK constraint/);

        // Удаление правила
        await db.removeAclRule('user', '123456789', 'blacklist');
        assert.equal(await db.checkAccess('user', '123456789', 'blacklist'), null);

        const allRules = await db.getAclRules();
        assert.equal(allRules.length, 2);
        console.log('✅ CRUD для acl протестирован: add, check, remove, CHECK-валидация работают.');

        // 7. Тестирование триггеров и таймеров (валидация и чистота схемы)
        console.log('\n7. Тестирование триггеров и таймеров...');
        await db.saveTrigger('тест', ['ответ 1', 'ответ 2'], { enabled: true, used: 5 });
        const trg = await db.getTrigger('тест');
        assert(trg);
        assert.equal(trg.responses.length, 2);
        assert.equal(trg.used_count, 5);

        await db.saveTimer({
            name: 'напоминалка',
            chatId: '100200300',
            messageText: 'Пора работать',
            triggerTime: new Date(Date.now() + 60000),
            intervalSeconds: 60,
            enabled: true
        });
        const tmr = await db.getTimer('напоминалка');
        assert(tmr);
        assert.equal(tmr.chat_id, '100200300');
        assert.equal(tmr.message_text, 'Пора работать');

        await db.deleteTrigger('тест');
        assert.equal(await db.getTrigger('тест'), null);

        await db.deleteTimer('напоминалка');
        assert.equal(await db.getTimer('напоминалка'), null);
        console.log('✅ Триггеры и таймеры: схема валидна, CRUD работает штатно.');

        // 8. Остановка службы
        console.log('\n8. Остановка службы db.stop()...');
        await dbModule.stop(core);
        assert.equal(dbModule._service, null);
        console.log('✅ Соединение с БД корректно закрыто.');

        console.log('\n🎉 ВСЕ ТЕСТЫ P0 УСПЕШНО ПРОЙДЕНЫ!');
    } finally {
        // Уборка тестовой директории
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }
}

runTests().catch((err) => {
    console.error('❌ Ошибка выполнения тестов:', err);
    process.exit(1);
});
