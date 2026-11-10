const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const secretFiles = require('../../../secret_files.js');
const paths = require('../../../paths.js');

function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
    name: 'utils',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: [],

    async init(core) {
        const utilsService = {
            isSecretName: secretFiles.isSecretName,
            isSecretPath: secretFiles.isSecretPath,
            resolveBotPath: secretFiles.resolveBotPath,
            resolveRestore: secretFiles.resolveRestore,
            paths: {
                DATA_DIR: paths.DATA_DIR,
                DB_PATH: paths.DB_PATH,
                SESSION_PATH: paths.SESSION_PATH,
                CONFIG_PATH: paths.CONFIG_PATH,
                SETTINGS_PATH: paths.SETTINGS_PATH,
                BACKUPS_DIR: paths.BACKUPS_DIR,
                getDataDir: paths.getDataDir
            },
            isTempOrVirtual: paths.isTempOrVirtual,
            safeCompare
        };

        core.provide('utils', utilsService);
        core.log('utils', 'Служба utils инициализирована');
    },

    async stop(core) {
        // Сервис утилит не держит открытых дескрипторов
    }
};
