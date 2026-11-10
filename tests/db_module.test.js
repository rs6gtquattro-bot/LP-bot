require('./_no_network.js')();
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCore } = require('../main.js');
const dbModule = require('../modules/core/db/index.js');

async function runTests() {
    console.log('🧪 Запуск тестов модуля службы базы данных modules/core/db...\n');

    // 1. Проверка контракта модуля
    console.log('1. Проверка контракта docs/modules.md...');
    assert.equal(dbModule.name, 'db');
    assert.equal(dbModule.version, '1.0.0');
    assert.equal(dbModule.engine, '^1.0.0');
    assert.deepEqual(dbModule.requires, []);
    assert.equal(typeof dbModule.init, 'function');
    assert.equal(typeof dbModule.stop, 'function');
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

        // 4. Проверка схем и таблиц
        console.log('\n4. Проверка создания всех таблиц и справочников...');
        const tables = (await db.all("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name);
        const requiredTables = [
            'users', 'access_levels', 'user_stats', 'command_history',
            'photo_boost_stats', 'triggers', 'templates', 'timers',
            'vk_state', '_corrupted_users_backup', 'schema_migrations'
        ];
        for (const reqTable of requiredTables) {
            assert(tables.includes(reqTable), `Таблица ${reqTable} должна существовать в БД`);
        }

        const levels = await db.all('SELECT * FROM access_levels ORDER BY level');
        assert.equal(levels.length, 5, 'Должно быть 5 уровней доступа');
        assert.equal(levels[4].name, 'owner');
        console.log(`✅ Все ${requiredTables.length} таблиц и справочник уровней доступа успешно созданы.`);

        // 5. Тестирование пользователей и защиты от [object Object]
        console.log('\n5. Тестирование методов пользователей и защиты от [object Object]...');
        // Попытка вставки [object Object]
        const blocked = await db.ensureUser({ foo: 'bar' });
        assert.equal(blocked, null, 'Вставка объекта без id должна быть отклонена');

        // Корректная вставка пользователя
        const user1 = await db.ensureUser(123456789n, 'testuser', 'Test', 'User', 1);
        assert(user1, 'Пользователь должен быть создан');
        assert.equal(user1.tg_id, 123456789);
        assert.equal(user1.username, 'testuser');
        assert.equal(user1.access_level, 1);

        const fetchedUser = await db.getUser('123456789');
        assert.equal(fetchedUser.id, user1.id);
        console.log('✅ Пользователь успешно сохранён, защита от [object Object] работает.');

        // 6. Тестирование атомарного UPSERT триггеров
        console.log('\n6. Тестирование атомарного UPSERT триггеров...');
        const triggersMap = new Map();
        triggersMap.set('привет', {
            word: 'привет',
            responses: ['Привет, мир!'],
            settings: { enabled: true, used: 3 }
        });
        triggersMap.set('пинг', {
            word: 'пинг',
            responses: ['понг'],
            settings: { enabled: true, used: 10 }
        });

        await db.saveTriggers(triggersMap);
        let loaded = await db.loadTriggers();
        assert.equal(loaded.size, 2);
        assert.equal(loaded.get('привет').used_count, 3);
        assert.equal(loaded.get('пинг').responses[0], 'понг');

        // Обновление триггеров (один удаляем, один обновляем, один добавляем)
        triggersMap.delete('пинг');
        triggersMap.get('привет').responses.push('И снова здравствуй!');
        triggersMap.get('привет').settings.used = 15;
        triggersMap.set('новый', {
            word: 'новый',
            responses: ['тест'],
            settings: { enabled: true, used: 1 }
        });

        await db.saveTriggers(triggersMap);
        loaded = await db.loadTriggers();
        assert.equal(loaded.size, 2);
        assert(!loaded.has('пинг'), 'Удаленный триггер "пинг" должен быть удален');
        assert.equal(loaded.get('привет').responses.length, 2);
        assert.equal(loaded.get('привет').used_count, 15);
        assert(loaded.has('новый'));
        console.log('✅ Атомарный UPSERT триггеров работает штатно без потери данных.');

        // 7. Тестирование шаблонов и сохранения статистики
        console.log('\n7. Тестирование шаблонов (UPSERT с сохранением used_count)...');
        await db.saveTemplate({
            name: 'шаблон1',
            contentType: 'text',
            textContent: 'Привет шаблон',
            mediaData: null,
            fileName: null,
            mimeType: null
        });

        // Накручиваем статистику использования
        await db.updateTemplateUsage('шаблон1');
        await db.updateTemplateUsage('шаблон1');
        let tpl = await db.getTemplate('шаблон1');
        assert.equal(tpl.used_count, 2, 'used_count должен быть равен 2');

        // Обновляем шаблон (статистика НЕ должна сбрасываться!)
        await db.saveTemplate({
            name: 'шаблон1',
            contentType: 'text',
            textContent: 'Обновленный текст',
            mediaData: null,
            fileName: null,
            mimeType: null
        });

        tpl = await db.getTemplate('шаблон1');
        assert.equal(tpl.text_content, 'Обновленный текст');
        assert.equal(tpl.used_count, 2, 'used_count НЕ должен сбрасываться в 0 при обновлении!');
        console.log('✅ Статистика шаблонов сохраняется при обновлении.');

        // 8. Тестирование транзакционности (Rollback при ошибке)
        console.log('\n8. Тестирование транзакционности (Rollback)...');
        try {
            await db.transaction(async (tx) => {
                await tx.run('INSERT INTO access_levels (level, name, description) VALUES (?, ?, ?)', [99, 'temp', 'test']);
                throw new Error('Имитация фатального сбоя');
            });
        } catch (e) {
            assert.equal(e.message, 'Имитация фатального сбоя');
        }

        const rolledBack = await db.get('SELECT * FROM access_levels WHERE level = 99');
        assert.equal(rolledBack, undefined, 'Транзакция должна быть полностью откатана');
        console.log('✅ Механизм транзакций и отката работает корректно.');

        // 9. Остановка службы
        console.log('\n9. Тестирование остановки службы db.stop()...');
        await dbModule.stop(core);
        assert.equal(dbModule._service, null);
        console.log('✅ Соединение с БД корректно закрыто.');

        console.log('\n🎉 ВСЕ ТЕСТЫ СЛУЖБЫ DB УСПЕШНО ПРОЙДЕНЫ!');
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
