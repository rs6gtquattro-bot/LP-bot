class ProcessService {
    constructor(core) {
        this.core = core;
        this.startTime = new Date();
        this.handlers = [];
    }

    uptime() {
        return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    }

    uptimeText() {
        const u = this.uptime();
        const h = Math.floor(u / 3600);
        const m = Math.floor((u % 3600) / 60);
        const s = u % 60;
        return `${h}ч ${m}м ${s}с`;
    }

    memoryMb() {
        return Math.round(process.memoryUsage().rss / (1024 * 1024));
    }

    getMetrics() {
        return {
            uptime: this.uptime(),
            uptimeText: this.uptimeText(),
            memoryMb: this.memoryMb(),
            nodeVersion: process.version,
            platform: process.platform,
            pid: process.pid
        };
    }

    async shutdown(code = 0) {
        if (this.core && typeof this.core.log === 'function') {
            this.core.log('process', `Завершение процесса с кодом ${code}`);
        }
        if (this.core && typeof this.core.stop === 'function') {
            await this.core.stop();
        }
        process.exit(code);
    }

    setupSignalHandlers() {
        const onSignal = async (sig) => {
            if (this.core && typeof this.core.log === 'function') {
                this.core.log('process', `Получен сигнал ${sig}, инициирован graceful shutdown...`);
            }
            await this.shutdown(0);
        };

        const sigint = () => onSignal('SIGINT');
        const sigterm = () => onSignal('SIGTERM');

        process.once('SIGINT', sigint);
        process.once('SIGTERM', sigterm);

        this.handlers.push(
            () => process.removeListener('SIGINT', sigint),
            () => process.removeListener('SIGTERM', sigterm)
        );
    }

    cleanupHandlers() {
        for (const cleanup of this.handlers) {
            try { cleanup(); } catch {}
        }
        this.handlers = [];
    }
}

module.exports = {
    name: 'process',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: [],

    async init(core) {
        const service = new ProcessService(core);
        // Сигналы перехватываем только если не в тестовом режиме
        if (!process.env.NO_PROCESS_SIGNALS) {
            service.setupSignalHandlers();
        }
        core.provide('process', service);
        core.log('process', 'Служба process инициализирована');
    },

    async stop(core) {
        try {
            const service = core.get('process');
            if (service && typeof service.cleanupHandlers === 'function') {
                service.cleanupHandlers();
            }
        } catch {}
    }
};
