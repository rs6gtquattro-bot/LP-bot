// Engine only on import; the legacy bot starts only through start()/node main.js.
const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

function createCore({ logger = console.log } = {}) {
    const services = new Map(), commands = new Map(), events = new Map();
    const loaded = new Map(), disabled = new Map();
    let used = false, stopped = false;
    const validName = name => typeof name === 'string' && name.length > 0 && !/\s/.test(name);
    const redact = text => String(text)
        .replace(/\b(?:vk1\.[\w.-]+|sk-[\w-]+)/gi, '[REDACTED]')
        .replace(/((?:[\w.-]*(?:token|password|secret|api[_-]?hash|api[_-]?key)|session)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
    const core = {
        version, commands, modules: { loaded, disabled },
        provide(name, obj) {
            if (!validName(name)) throw new TypeError('Invalid service name');
            if (services.has(name)) throw new Error(`Duplicate service: ${name}`);
            services.set(name, obj);
            return obj;
        },
        get(name) {
            if (!services.has(name)) throw new Error(`Unknown service: ${name}`);
            return services.get(name);
        },
        command(name, handler, meta = {}) {
            if (!validName(name) || typeof handler !== 'function') throw new TypeError('Invalid command');
            if (commands.has(name)) throw new Error(`Duplicate command: ${name}`);
            commands.set(name, { ...meta, handler });
            return commands.get(name);
        },
        on(event, fn) {
            if (typeof fn !== 'function') throw new TypeError('Invalid listener');
            if (!events.has(event)) events.set(event, []);
            events.get(event).push(fn);
            return core;
        },
        async emit(event, ...args) {
            await Promise.all([...(events.get(event) || [])].map(async fn => {
                try { await fn(...args); } catch { core.log('events', `Listener failed: ${event}`); }
            }));
        },
        log(module, text) { try { logger(`[${redact(module)}] ${redact(text)}`); } catch { /* Logging must not break isolation. */ } }
    };
    const disable = (name, reason) => {
        if (!disabled.has(name)) { disabled.set(name, reason); core.log(name, `Disabled: ${reason}`); }
    };
    // Deliberately small range grammar: stable exact x.y.z or ^x.y.z; no dependency needed.
    const compatible = range => {
        const match = /^(\^?)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(range);
        if (!match) return false;
        const min = match.slice(2).map(Number), actual = version.split('.').map(Number);
        const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
        const upper = min[0] ? [min[0] + 1, 0, 0] : min[1] ? [0, min[1] + 1, 0] : [0, 0, min[2] + 1];
        return match[1] ? compare(actual, min) >= 0 && compare(actual, upper) < 0 : compare(actual, min) === 0;
    };
    core.loadModules = async (root = path.join(__dirname, 'modules')) => {
        if (used || stopped) throw new Error('Loader already used or stopped');
        used = true;
        const candidates = new Map(), visiting = new Set();
        const discover = dir => {
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
            catch (error) { if (error.code !== 'ENOENT') disable(path.relative(root, dir) || 'modules', 'Directory unreadable'); return; }
            if (!entries.some(entry => entry.isFile() && entry.name === 'index.js')) {
                for (const entry of entries) if (entry.isDirectory()) discover(path.join(dir, entry.name));
                return;
            }
            let mod, id = path.relative(root, dir) || 'modules';
            try {
                mod = require(path.resolve(dir, 'index.js'));
                if (!mod || !validName(mod.name) || typeof mod.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(mod.version)) throw new Error();
                id = mod.name;
                if (candidates.has(id) || disabled.has(id) || loaded.has(id)) { disable(id, 'Duplicate module name'); return; }
                if (!compatible(mod.engine)) { disable(id, 'Incompatible engine'); return; }
                if (!Array.isArray(mod.requires) || !mod.requires.every(validName)) throw new Error();
                if (mod.init !== undefined && typeof mod.init !== 'function') throw new Error();
                if (mod.stop !== undefined && typeof mod.stop !== 'function') throw new Error();
                candidates.set(id, mod);
            } catch { disable(id, 'Invalid export or require failed'); }
        };
        const restore = (target, snapshot) => { target.clear(); for (const [key, value] of snapshot) target.set(key, value); };
        const visit = async name => {
            if (loaded.has(name)) return true;
            if (disabled.has(name)) return false;
            if (visiting.has(name)) { disable(name, 'Dependency cycle'); return false; }
            const mod = candidates.get(name);
            visiting.add(name);
            try {
                for (const dep of mod.requires) {
                    if (!candidates.has(dep) || !await visit(dep)) { disable(name, `Dependency unavailable: ${dep}`); return false; }
                }
                const snapshot = [new Map(services), new Map(commands), new Map([...events].map(([key, fns]) => [key, [...fns]]))];
                try {
                    for (const [cmd, spec] of Object.entries(mod.commands || {})) {
                        if (!spec || !Array.isArray(spec.aliases || [])) throw new Error();
                        for (const alias of [cmd, ...(spec.aliases || [])]) core.command(alias, spec.handler, { help: spec.help, module: name });
                    }
                    if (mod.init) await mod.init(core);
                    loaded.set(name, mod);
                    core.log(name, `Loaded ${mod.version}`);
                    return true;
                } catch {
                    try { if (mod.stop) await mod.stop(core); } catch { core.log(name, 'Cleanup failed'); }
                    [services, commands, events].forEach((target, i) => restore(target, snapshot[i]));
                    disable(name, 'Initialization or command registration failed');
                    return false;
                }
            } finally { visiting.delete(name); }
        };
        discover(root);
        for (const name of candidates.keys()) await visit(name);
        return core.modules;
    };
    core.stop = async () => {
        if (stopped) return;
        stopped = true;
        await core.emit('stop');
        for (const [name, mod] of [...loaded].reverse()) {
            try { if (mod.stop) await mod.stop(core); } catch { core.log(name, 'Stop failed'); }
        }
    };
    core.command('движок', () => [
        `Движок ${core.version}`,
        `Загружены: ${[...loaded.keys()].join(', ') || 'нет'}`,
        `Отключены: ${[...disabled].map(([name, reason]) => `${name} (${reason})`).join(', ') || 'нет'}`,
        'Положи папку в modules/, экспортируй объект { name, version, engine, requires, commands, init, stop }, перезапусти бота.',
        'Формат модуля: docs/modules.md'
    ].join('\n'), { help: 'Версия движка и состояние модулей', module: 'engine' });
    return core;
}

async function start({ modulesDir, logger, legacy = () => require('./script.js') } = {}) {
    const core = createCore({ logger });
    await core.loadModules(modulesDir);
    await core.emit('ready'); // Engine ready, not Telegram authorization.
    legacy(); // script.js retains its entire existing startup, unchanged.
    return core;
}

module.exports = { createCore, start };
if (require.main === module) start().catch(() => { console.error('[engine] Startup failed'); process.exitCode = 1; });
