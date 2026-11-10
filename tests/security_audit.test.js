require('./_no_network.js')(); // Изоляция сети
const path = require('path');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const { createCore } = require('../main.js');
const { isSecretPath, resolveBotPath } = require('../secret_files.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

(async () => {
    console.log('=== SECURITY AUDIT SUITE: Комплексная проверка безопасности ===');

    // 1. Санитизация и маскирование секретов в логах ядра (core.log)
    {
        const loggedLines = [];
        const core = createCore({ logger: (line) => loggedLines.push(line) });

        const rawSecrets = [
            'VK_USER_TOKEN=vk1.a.abcdef1234567890_-ABCDEF',
            'api_key="sk-or-v1-abcdef1234567890"',
            'password = "SuperSecretPassword123"',
            'session="1AZXCasdqwe1234=="',
            'api_hash: "0123456789abcdef0123456789abcdef"'
        ];

        for (const sec of rawSecrets) {
            core.log('security', sec);
        }

        let leak = false;
        for (const line of loggedLines) {
            if (line.includes('vk1.a.abcdef') || line.includes('sk-or-v1') ||
                line.includes('SuperSecretPassword123') || line.includes('1AZXCasdqwe') ||
                line.includes('0123456789abcdef0123456789abcdef')) {
                leak = true;
            }
        }
        check('SEC-01: core.log гарантированно маскирует все типы секретов [REDACTED]', !leak && loggedLines.every(l => l.includes('[REDACTED]')));
    }

    // 2. Защита от загрязнения прототипа JS (Prototype Pollution)
    {
        const core = createCore({ logger: () => {} });
        const dangerousProps = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];

        let polluted = false;
        for (const prop of dangerousProps) {
            if (core.commands.has(prop)) polluted = true;
            try {
                core.get(prop);
                polluted = true;
            } catch (e) {
                // Ожидаемый Unknown service
            }
        }
        check('SEC-02: Реестры команд и служб ядра защищены от Prototype Pollution', !polluted && Object.prototype.toString.call({}) === '[object Object]');
    }

    // 3. Защита файловой системы: NTFS Alternate Data Streams (ADS) и обход путей
    {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-sec-ads-'));
        fs.writeFileSync(path.join(tempDir, 'session.txt'), 'SECRET');

        const adsPaths = [
            'session.txt::$DATA',
            'config.json::$DATA',
            'settings.json::$DATA',
            'session.txt:hidden',
            'CONFIG.JSON::$DATA'
        ];

        let adsBlocked = true;
        for (const p of adsPaths) {
            try {
                resolveBotPath(tempDir, p);
                adsBlocked = false; // не должно разрешиться
            } catch (e) {
                // корректно заблокировано
            }
        }
        check('SEC-03: NTFS Alternate Data Streams (ADS, ::$DATA) блокируются', adsBlocked);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }

    // 4. Защита от Path Traversal с разными типами слешей (\ и /)
    {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-sec-trav-'));
        const travPaths = [
            '..\\..\\windows\\system32\\cmd.exe',
            '../../etc/passwd',
            'sub/../../session.txt',
            'sub\\..\\..\\config.json',
            '....//....//session.txt'
        ];

        let travBlocked = true;
        for (const p of travPaths) {
            try {
                resolveBotPath(tempDir, p);
                travBlocked = false;
            } catch (e) {
                // корректно заблокировано
            }
        }
        check('SEC-04: Path Traversal с любыми слешами (\\ и /) полностью блокируется', travBlocked);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }

    // 5. Защита от подделки модулей (Module Injection / Malicious Module)
    {
        const core = createCore({ logger: () => {} });
        const invalidMods = [
            { name: '', version: '1.0.0', engine: '^1.0.0' },
            { name: 'mod/slash', version: '1.0.0', engine: '^1.0.0' },
            { name: 'mod space', version: '1.0.0', engine: '^1.0.0' },
            { name: 'evil', version: '1.0.0', engine: 'invalid-semver' },
            { name: 'evil2', version: 'alpha', engine: '^1.0.0' }
        ];

        let rejected = true;
        const tempModDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-sec-mod-'));
        for (let i = 0; i < invalidMods.length; i++) {
            const m = invalidMods[i];
            const p = path.join(tempModDir, `mod_${i}`);
            fs.mkdirSync(p, { recursive: true });
            fs.writeFileSync(path.join(p, 'index.js'), `module.exports = ${JSON.stringify(m)};`);
        }

        await core.loadModules(tempModDir);
        for (const m of invalidMods) {
            if (core.modules.loaded.has(m.name)) rejected = false;
        }
        check('SEC-05: Валидатор загрузчика отклоняет вредоносные спецификации модулей', rejected && core.modules.loaded.size === 0);
        try { fs.rmSync(tempModDir, { recursive: true, force: true }); } catch {}
    }

    console.log('\n----------------------------------------');
    const fails = results.filter(r => !r).length;
    console.log(fails ? `ИТОГ: ПРОВАЛОВ ${fails} из ${results.length}` : `ИТОГ: ВСЕ SECURITY-ТЕСТЫ ПРОЙДЕНЫ (${results.length} из ${results.length})`);
    process.exit(fails ? 1 : 0);
})().catch(e => {
    console.error('FAIL Исключение в security suite:', e);
    process.exit(1);
});
