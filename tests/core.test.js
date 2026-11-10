require('./_no_network.js')();
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createCore, start } = require('../main.js');
const tests = [], roots = [];
const test = (name, fn) => tests.push([name, fn]);
const quiet = () => createCore({ logger: () => {} });
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-core-')); roots.push(dir); return dir; };
function fixture(root, dir, name, extra = '') {
    const folder = path.join(root, dir);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.js'), `module.exports = { name: ${JSON.stringify(name)}, version: '1.0.0', engine: '^2.0.0', requires: [], ${extra} };\n`);
}
const names = map => [...map.keys()];

test('import is inert; version comes from package.json', () => {
    assert.equal(quiet().version, '2.0.0');
    assert.equal(quiet().version, require('../package.json').version);
    assert.equal(require.cache[require.resolve('../script.js')], undefined);
});
test('provide/get including undefined; unknown and duplicate services throw', () => {
    const core = quiet(), value = {};
    assert.equal(core.provide('db', value), value);
    assert.equal(core.get('db'), value);
    core.provide('empty', undefined);
    assert.equal(core.get('empty'), undefined);
    assert.throws(() => core.get('missing'), /Unknown service/);
    assert.throws(() => core.get('constructor'), /Unknown service/);
    assert.throws(() => core.provide('db', {}), /Duplicate service/);
});
test('command handler/meta; duplicate is a startup error, never overwrite', async () => {
    const core = quiet(), fn = async () => 'actual result';
    core.command('example', fn, { help: 'help' });
    assert.equal(core.commands.get('example').handler, fn);
    assert.equal(await core.commands.get('example').handler(core, {}), 'actual result');
    assert.equal(core.commands.get('example').help, 'help');
    assert.throws(() => core.command('example', () => 'bad'), /Duplicate command/);
    assert.equal(core.commands.get('example').handler, fn);
    assert.throws(() => core.command('', fn), /Invalid command/);
    assert.throws(() => core.command('broken', null), /Invalid command/);
});
test('JS prototype names are not commands or services', () => {
    const core = quiet();
    assert(core.commands instanceof Map);
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
        assert.equal(core.commands.has(name), false);
        assert.equal(core.commands.get(name), undefined);
        assert.throws(() => core.get(name), /Unknown service/);
    }
    // Explicit registration is allowed, but never inherited from Object.prototype.
    core.command('constructor', () => 'explicit');
    assert.equal(core.commands.get('constructor').handler(), 'explicit');
});
test('on/emit awaits multiple listeners and preserves arguments', async () => {
    const core = quiet(), calls = [], message = {};
    core.on('message', async (...args) => { await Promise.resolve(); calls.push(args); });
    core.on('message', (...args) => calls.push(args));
    await core.emit('message', message, 'TG', 7);
    assert.deepEqual(calls, [[message, 'TG', 7], [message, 'TG', 7]]);
    await core.emit('no-listeners');
    assert.throws(() => core.on('message', null), /Invalid listener/);
});
test('listener rejection is isolated; remaining listener runs', async () => {
    const lines = [], core = createCore({ logger: line => lines.push(line) });
    let delivered = false;
    core.on('ready', async () => { throw new Error('do not log exception text'); });
    core.on('ready', () => { delivered = true; });
    await core.emit('ready');
    assert(delivered);
    assert(lines.some(line => line.includes('Listener failed: ready')));
    assert(!lines.join('\n').includes('exception text'));
});
test('log has module tag and redacts synthetic labeled secrets/key prefixes', () => {
    const lines = [], core = createCore({ logger: line => lines.push(line) });
    core.log('fixture', 'normal message');
    core.log('fixture', 'VK_USER_TOKEN=fixture-value password="fixture-pass" apiKey=fixture-key apiHash=fixture-hash session=fixture-session vk1.a.fixture sk-fixture-key');
    assert.equal(lines[0], '[fixture] normal message');
    for (const secret of ['fixture-value', 'fixture-pass', 'fixture-key', 'fixture-hash', 'fixture-session', 'vk1.a.fixture', 'sk-fixture-key']) {
        assert(!lines[1].includes(secret));
    }
    assert(lines[1].includes('[REDACTED]'));
    assert.doesNotThrow(() => createCore({ logger() { throw new Error(); } }).log('test', 'message'));
});
test('recursive loader orders requires before consumers; real handlers and aliases work', async () => {
    const root = temp(), core = quiet();
    core.provide('order', []);
    fixture(root, 'commands/a-consumer', 'consumer', `requires: ['service'], commands: { greet: { handler: (core, ctx) => core.get('service') + ctx.args, help: 'greeting', aliases: ['hi'] } }, async init(core) { core.get('order').push('consumer'); }`);
    fixture(root, 'core/z-service', 'service', `async init(core) { await Promise.resolve(); core.provide('service', 'hello '); core.get('order').push('service'); }`);
    await core.loadModules(root);
    assert.deepEqual(core.get('order'), ['service', 'consumer']);
    assert.deepEqual(names(core.modules.loaded), ['service', 'consumer']);
    assert.equal(core.modules.disabled.size, 0);
    assert.equal(await core.commands.get('greet').handler(core, { args: 'world' }), 'hello world');
    assert.equal(await core.commands.get('hi').handler(core, { args: 'alias' }), 'hello alias');
    assert.equal(core.commands.get('hi').help, 'greeting');
});
test('bad engines disabled; exact and caret stable engine 2.0.0 accepted', async () => {
    const root = temp(), core = quiet();
    for (const [i, engine] of ['^1.0.0', '^3.0.0', '^2.1.0', '*', '^2.0.0-beta', '2.0.1', null].entries()) {
        fixture(root, 'bad' + i, 'bad' + i, `engine: ${JSON.stringify(engine)}, init() { throw new Error('must not run'); }`);
    }
    fixture(root, 'exact', 'exact', `engine: '2.0.0'`);
    fixture(root, 'caret', 'caret');
    await core.loadModules(root);
    assert.equal(core.modules.disabled.size, 7);
    for (const reason of core.modules.disabled.values()) assert.equal(reason, 'Incompatible engine');
    assert.deepEqual(names(core.modules.loaded), ['caret', 'exact']);
});
test('init failure rolls back services/commands/events, cleanup runs; neighbor alive', async () => {
    const root = temp(), core = quiet(), lines = [];
    core.provide('trace', lines);
    core.provide('stable', 'kept');
    core.command('stable', () => 'kept');
    core.on('message', () => lines.push('stable listener'));
    fixture(root, 'a-broken', 'broken', `commands: { leaked: { handler: () => 'bad' } }, async init(core) { core.provide('leaked', 1); core.on('message', () => core.get('trace').push('leaked listener')); throw new Error('synthetic private exception'); }, async stop(core) { core.get('trace').push('cleanup'); }`);
    fixture(root, 'b-dependent', 'dependent', `requires: ['broken'], init() { throw new Error('must not run'); }`);
    fixture(root, 'z-live', 'live', `commands: { alive: { handler: () => 'alive' } }`);
    await core.loadModules(root);
    assert(core.modules.disabled.has('broken'));
    assert(core.modules.disabled.has('dependent'));
    assert.deepEqual(names(core.modules.loaded), ['live']);
    assert.throws(() => core.get('leaked'), /Unknown service/);
    assert.equal(core.commands.has('leaked'), false);
    assert.equal(core.get('stable'), 'kept');
    assert.equal(core.commands.get('stable').handler(), 'kept');
    assert.equal(core.commands.get('alive').handler(), 'alive');
    await core.emit('message');
    assert.deepEqual(lines, ['cleanup', 'stable listener']);
});
test('require exception/syntax error/invalid export isolated; raw exceptions not logged', async () => {
    const root = temp(), lines = [], core = createCore({ logger: line => lines.push(line) });
    fixture(root, 'a-require', 'unused');
    fs.writeFileSync(path.join(root, 'a-require/index.js'), 'throw new Error("fixture-private-error");');
    fixture(root, 'b-syntax', 'unused');
    fs.writeFileSync(path.join(root, 'b-syntax/index.js'), 'invalid {{{ syntax');
    fixture(root, 'c-invalid', 'unused');
    fs.writeFileSync(path.join(root, 'c-invalid/index.js'), 'module.exports = null;');
    fixture(root, 'z-neighbor', 'neighbor');
    await core.loadModules(root);
    assert.equal(core.modules.disabled.size, 3);
    assert.deepEqual(names(core.modules.loaded), ['neighbor']);
    assert(!lines.join('\n').includes('fixture-private-error'));
});
test('missing requirement, cycle and their dependents disabled; independent module alive', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'a', 'a', `requires: ['b']`);
    fixture(root, 'b', 'b', `requires: ['a']`);
    fixture(root, 'dependent', 'dependent', `requires: ['a']`);
    fixture(root, 'missing', 'missing', `requires: ['nonexistent']`);
    fixture(root, 'live', 'live');
    await core.loadModules(root);
    assert.deepEqual(names(core.modules.loaded), ['live']);
    assert.equal(core.modules.disabled.size, 4);
    assert.match(core.modules.disabled.get('a'), /cycle/);
    assert.match(core.modules.disabled.get('missing'), /nonexistent/);
});
test('duplicate module names disable both copies, never execute init', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'a', 'same', `init() { throw new Error('must not run'); }`);
    fixture(root, 'b', 'same', `init() { throw new Error('must not run'); }`);
    fixture(root, 'z', 'live');
    await core.loadModules(root);
    assert.equal(core.modules.disabled.get('same'), 'Duplicate module name');
    assert.deepEqual(names(core.modules.loaded), ['live']);
});
test('module duplicate command/alias rejected with rollback, original survives', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'a-owner', 'owner', `commands: { ping: { handler: () => 'original', aliases: ['pong'] } }`);
    fixture(root, 'b-duplicate', 'duplicate', `commands: { temporary: { handler: () => 0 }, pong: { handler: () => 'overwrite' } }`);
    fixture(root, 'c-internal', 'internal', `commands: { name: { handler: () => 0, aliases: ['name'] } }`);
    fixture(root, 'd-engine', 'engine-conflict', `init(core) { core.command('движок', () => 'overwrite'); }`);
    fixture(root, 'z-live', 'live');
    await core.loadModules(root);
    assert.deepEqual(names(core.modules.loaded), ['owner', 'live']);
    assert.equal(core.modules.disabled.size, 3);
    assert.equal(core.commands.get('ping').handler(), 'original');
    assert.equal(core.commands.get('pong').handler(), 'original');
    assert(!core.commands.has('temporary'));
    assert(!core.commands.has('name'));
    assert.match(core.commands.get('движок').handler(core, {}), /2\.0\.0/);
});
test('malformed command, invalid lifecycle and failed cleanup do not stop neighbors', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'a-bad-handler', 'bad-handler', `commands: { partial: { handler: () => 0 }, bad: { help: 'missing handler' } }`);
    fixture(root, 'b-bad-alias', 'bad-alias', `commands: { bad: { handler: () => 0, aliases: 'not-an-array' } }`);
    fixture(root, 'c-bad-init', 'bad-init', `init: 'not-a-function'`);
    fixture(root, 'd-bad-stop', 'bad-stop', `stop: 'not-a-function'`);
    fixture(root, 'e-cleanup', 'cleanup', `init(core) { core.provide('partial', 1); throw new Error(); }, stop() { throw new Error(); }`);
    fixture(root, 'z-live', 'live');
    await core.loadModules(root);
    assert.deepEqual(names(core.modules.loaded), ['live']);
    assert.equal(core.modules.disabled.size, 5);
    assert(!core.commands.has('partial'));
    assert.throws(() => core.get('partial'), /Unknown service/);
});
test('module cannot overwrite a dependency service; rollback retains original', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'a', 'a', `init(core) { core.provide('db', 'original'); }`);
    fixture(root, 'b', 'b', `requires: ['a'], init(core) { core.provide('partial', 1); core.provide('db', 'bad'); }`);
    await core.loadModules(root);
    assert(core.modules.disabled.has('b'));
    assert.equal(core.get('db'), 'original');
    assert.throws(() => core.get('partial'), /Unknown service/);
});
test('stop event once, reverse dependency stop order, isolated stop errors', async () => {
    const root = temp(), core = quiet(), calls = [];
    core.provide('calls', calls);
    core.on('stop', () => calls.push('event'));
    fixture(root, 'a-consumer', 'consumer', `requires: ['service'], stop(core) { core.get('calls').push('consumer'); throw new Error('fixture stop error'); }`);
    fixture(root, 'z-service', 'service', `stop(core) { core.get('calls').push('service'); }`);
    await core.loadModules(root);
    await core.stop();
    await core.stop();
    assert.deepEqual(calls, ['event', 'consumer', 'service']);
});
test('engine command returns actual lists, version and prefix-neutral instructions', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'live', 'live');
    fixture(root, 'bad', 'bad', `engine: '^3.0.0'`);
    await core.loadModules(root);
    const text = await core.commands.get('движок').handler(core, {});
    for (const expected of ['2.0.0', 'Загружены: live', 'Отключены: bad', 'modules/', 'экспортируй объект', 'перезапусти бота', 'docs/modules.md']) {
        assert(text.includes(expected));
    }
    assert(!/[‘’']движок/.test(text));
    assert.match(quiet().commands.get('движок').handler(), /Загружены: нет\nОтключены: нет/);
});
test('empty/missing modules directory accepted; loader is one-shot and inert on import', async () => {
    const root = temp(), core = quiet();
    await core.loadModules(path.join(root, 'absent'));
    assert.equal(core.modules.loaded.size, 0);
    assert.equal(core.modules.disabled.size, 0);
    await assert.rejects(core.loadModules(root), /Loader already used/);
    const stopped = quiet();
    await stopped.stop();
    await assert.rejects(stopped.loadModules(root), /stopped/);
});
test('module directories are leaves; nested helper index.js not auto-loaded', async () => {
    const root = temp(), core = quiet();
    fixture(root, 'core/module', 'module');
    fixture(root, 'core/module/helper', 'helper', `init() { throw new Error('must not run'); }`);
    const elsewhere = temp();
    fixture(elsewhere, 'external', 'external');
    fs.symlinkSync(path.join(elsewhere, 'external'), path.join(root, 'symlink-module'), 'dir');
    await core.loadModules(root);
    assert.deepEqual(names(core.modules.loaded), ['module']);
    assert.equal(core.modules.disabled.size, 0);
});
test('start initializes modules, emits ready, then invokes legacy exactly once (stub only)', async () => {
    const root = temp(), calls = [];
    fixture(root, 'marker', 'marker', `init(core) { core.on('ready', () => core.log('marker', 'ready')); }`);
    const core = await start({ modulesDir: root, logger: line => calls.push(line), legacy: () => calls.push('legacy') });
    assert(core.modules.loaded.has('marker'));
    assert.deepEqual(calls, ['[marker] Loaded 1.0.0', '[marker] ready', 'legacy']);
});
test('default legacy delegate requires the unchanged script.js (require intercepted)', async () => {
    const root = temp(), original = Module._load;
    let legacyCalls = 0;
    Module._load = function (request, parent, ...args) {
        if (request === './script.js' && parent.filename === path.resolve(__dirname, '../main.js')) {
            legacyCalls++;
            return class StubLegacyBot {};
        }
        return original.call(this, request, parent, ...args);
    };
    try { await start({ modulesDir: root, logger: () => {} }); }
    finally { Module._load = original; }
    assert.equal(legacyCalls, 1);
    assert.equal(require.cache[require.resolve('../script.js')], undefined);
});
test('CLI entry initializes engine and delegates once even with a failed module (VM only)', async () => {
    const root = temp(), vm = require('vm'), calls = [], entry = { exports: {} };
    fixture(root, 'modules/bad', 'bad', `async init() { throw new Error('fixture CLI failure'); }`);
    const fakeRequire = name => {
        if (name === './script.js') { calls.push('legacy'); return {}; }
        if (name === './package.json') return require('../package.json');
        return require(name);
    };
    fakeRequire.main = entry;
    const context = {
        require: fakeRequire, module: entry, __dirname: root,
        console: { log: line => calls.push(line), error: line => calls.push(line) },
        process: { exitCode: undefined }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['[bad] Disabled: Initialization or command registration failed', 'legacy']);
    assert.equal(context.process.exitCode, undefined);
    assert.equal(require.cache[require.resolve('../script.js')], undefined);
});
test('main.js <=200 lines; legacy package entry/start preserved', () => {
    const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert(source.trimEnd().split('\n').length <= 200);
    const pkg = require('../package.json');
    assert.equal(pkg.main, 'script.js');
    assert.equal(pkg.scripts.start, 'node script.js');
    assert.match(fs.readFileSync(path.join(__dirname, '../start.bat'), 'utf8'), /^node main\.js\r?\npause/);
});

(async () => {
    let failed = 0;
    try {
        for (const [name, fn] of tests) {
            try { await fn(); console.log(`OK   ${name}`); }
            catch (error) { failed++; console.log(`FAIL ${name}\n${error.stack}`); }
        }
    } finally { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); }
    console.log(`ИТОГ: core ${tests.length - failed} OK, ${failed} FAIL`);
    process.exitCode = failed ? 1 : 0;
})();
