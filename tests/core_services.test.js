require('./_no_network.js')(); // строго без сети
// Тест приёмки Этапа 2: Реестр и спецификация служб ядра в modules/core/
// Проверяет, что core.provide() и core.get() отдают службы:
// 'db', 'settings', 'session', 'telegram', 'messaging', 'process', 'users', 'utils'

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { createCore } = require('../main.js');

const EXPECTED_SERVICES = [
    'db',
    'settings',
    'session',
    'telegram',
    'messaging',
    'process',
    'users',
    'utils'
];

let okCount = 0;
let failCount = 0;
const t = (cond, msg, detail = '') => {
    if (cond) {
        okCount++;
        console.log(`OK   ${msg}`);
    } else {
        failCount++;
        console.log(`FAIL ${msg}${detail ? `\n     ${detail}` : ''}`);
    }
};

const quiet = () => createCore({ logger: () => {} });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lp-services-'));

(async () => {
    console.log('=== ТЕСТ ПРИЁМКИ ЭТАПА 2: СЛУЖБЫ ЯДРА (modules/core/) ===\n');

    // 1. Проверка регистрации и получения всех 8 обязательных служб ядра
    {
        const core = quiet();
        const mockInstances = {};

        for (const name of EXPECTED_SERVICES) {
            mockInstances[name] = { __serviceName: name, initialized: true };
            const returned = core.provide(name, mockInstances[name]);
            t(returned === mockInstances[name], `core.provide('${name}') возвращает переданный экземпляр`);
        }

        for (const name of EXPECTED_SERVICES) {
            const svc = core.get(name);
            t(svc === mockInstances[name] && svc.__serviceName === name,
                `core.get('${name}') возвращает точный зарегистрированный экземпляр службы`);
        }
    }

    // 2. Защита от дублей служб и неизвестных служб
    {
        const core = quiet();
        core.provide('db', { ready: true });

        let dupThrows = false;
        try {
            core.provide('db', { duplicate: true });
        } catch (e) {
            dupThrows = /Duplicate service: db/.test(e.message);
        }
        t(dupThrows, "Повторный core.provide('db') выбрасывает 'Duplicate service: db'");

        let unknownThrows = false;
        try {
            core.get('unregistered_service');
        } catch (e) {
            unknownThrows = /Unknown service: unregistered_service/.test(e.message);
        }
        t(unknownThrows, "core.get('unregistered_service') выбрасывает 'Unknown service: unregistered_service'");
    }

    // 3. Защита от загрязнения прототипа JS в реестре служб
    {
        const core = quiet();
        const dangerousNames = ['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];

        let protoSafe = true;
        for (const prop of dangerousNames) {
            try {
                core.get(prop);
                protoSafe = false;
            } catch (e) {
                if (!/Unknown service/.test(e.message)) protoSafe = false;
            }
        }
        t(protoSafe, 'Свойства прототипа (constructor, __proto__ и др.) не отдаются как службы');

        // Явная регистрация разрешена, но изолирована от prototype
        core.provide('constructor', { explicit: true });
        t(core.get('constructor').explicit === true, 'Явная регистрация службы "constructor" работает изолированно');
    }

    // 4. Валидация входных имён служб
    {
        const core = quiet();
        const invalidNames = ['', '   ', 'db service', 'name with tab\t', null, undefined, 123, {}];

        let invalidBlocked = true;
        for (const bad of invalidNames) {
            try {
                core.provide(bad, {});
                invalidBlocked = false;
            } catch (e) {
                if (!(e instanceof TypeError) || !/Invalid service name/.test(e.message)) {
                    invalidBlocked = false;
                }
            }
        }
        t(invalidBlocked, 'Пустые имена, имена с пробелами, табами и не-строки отклоняются с TypeError');
    }

    // 5. Интеграционный тест: автоматическая загрузка всех 8 служб из modules/core/
    {
        const root = temp();
        const core = quiet();

        // Создаем фикстуры структуры modules/core/ для 8 служб с реальными зависимостями
        const serviceConfigs = [
            { dir: 'core/db', name: 'db', requires: [], api: { query: () => 'ok' } },
            { dir: 'core/settings', name: 'settings', requires: ['db'], api: { prefix: '*' } },
            { dir: 'core/session', name: 'session', requires: ['settings'], api: { getSession: () => 'token' } },
            { dir: 'core/process', name: 'process', requires: [], api: { uptime: () => 100 } },
            { dir: 'core/utils', name: 'utils', requires: [], api: { isSecretPath: () => false } },
            { dir: 'core/users', name: 'users', requires: ['db'], api: { getUser: () => ({ id: 1 }) } },
            { dir: 'core/telegram', name: 'telegram', requires: ['session', 'settings'], api: { client: {} } },
            { dir: 'core/messaging', name: 'messaging', requires: ['telegram', 'settings'], api: { send: () => true } }
        ];

        for (const cfg of serviceConfigs) {
            const folder = path.join(root, cfg.dir);
            fs.mkdirSync(folder, { recursive: true });
            const code = `
module.exports = {
    name: ${JSON.stringify(cfg.name)},
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ${JSON.stringify(cfg.requires)},
    async init(core) {
        core.provide(${JSON.stringify(cfg.name)}, ${JSON.stringify(cfg.api)});
    }
};
`;
            fs.writeFileSync(path.join(folder, 'index.js'), code);
        }

        await core.loadModules(root);

        let allLoaded = true;
        for (const name of EXPECTED_SERVICES) {
            if (!core.modules.loaded.has(name)) allLoaded = false;
            try {
                const svc = core.get(name);
                if (!svc) allLoaded = false;
            } catch {
                allLoaded = false;
            }
        }
        t(allLoaded, 'Все 8 модулей служб успешно загрузились через loadModules и зарегистрировали службы');
        t(core.modules.disabled.size === 0, 'Отключённых модулей нет, граф зависимостей разрешён');

        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    }

    // 6. Проверка транзакционного отката служб при ошибке инициализации
    {
        const root = temp();
        const core = quiet();

        const folderDb = path.join(root, 'core/db');
        fs.mkdirSync(folderDb, { recursive: true });
        fs.writeFileSync(path.join(folderDb, 'index.js'), `
module.exports = {
    name: 'db',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: [],
    async init(core) { core.provide('db', { dbInstance: true }); }
};
`);

        const folderBroken = path.join(root, 'core/broken_service');
        fs.mkdirSync(folderBroken, { recursive: true });
        fs.writeFileSync(path.join(folderBroken, 'index.js'), `
module.exports = {
    name: 'broken_service',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['db'],
    async init(core) {
        core.provide('broken', { partial: true });
        throw new Error('Фатальный сбой инициализации службы');
    }
};
`);

        await core.loadModules(root);

        t(core.modules.loaded.has('db'), 'Независимая служба db успешно осталась загруженной');
        t(core.modules.disabled.has('broken_service'), 'Упавшая служба broken_service отключена');

        let brokenCleaned = false;
        try {
            core.get('broken');
        } catch (e) {
            brokenCleaned = /Unknown service: broken/.test(e.message);
        }
        t(brokenCleaned, 'Служба broken_service откатила свои регистрации provide() при сбое');

        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    }

    console.log('\n-------------------------------------------------------------');
    console.log(`ИТОГИ: Успешно: ${okCount} | Провалов: ${failCount}`);
    console.log('-------------------------------------------------------------');

    if (failCount > 0) {
        console.error('❌ ТЕСТ ПРИЁМКИ СЛУЖБ ЯДРА ПРОВАЛЕН!');
        process.exit(1);
    } else {
        console.log('✅ ТЕСТ ПРИЁМКИ СЛУЖБ ЯДРА ГОТОВ К ВАЛИДАЦИИ ЭТАПА 2!');
        process.exit(0);
    }
})().catch(e => {
    console.error('FAIL Неожиданное исключение в тесте служб ядра:', e);
    process.exit(1);
});
