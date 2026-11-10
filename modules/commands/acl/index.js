let coreInstance = null;

async function resolveTargetUser(core, { args, message, chatId }) {
    let targetId = null;
    let targetName = null;
    let remainingArgs = args ? [...args] : [];

    // 1. Проверка ответа на сообщение
    if (message && message.replyTo && message.replyTo.replyToMsgId) {
        try {
            const telegram = core.get('telegram');
            const client = telegram && telegram.client;
            if (client && typeof client.getMessages === 'function') {
                const msgs = await client.getMessages(chatId, { ids: [message.replyTo.replyToMsgId] });
                if (msgs && msgs[0] && msgs[0].senderId) {
                    targetId = msgs[0].senderId;
                    targetName = msgs[0].sender ? (msgs[0].sender.firstName || msgs[0].sender.username) : String(targetId);
                }
            }
        } catch {}
    }

    // 2. Если ответ не дал ID, проверяем первый аргумент
    if (!targetId && remainingArgs.length > 0) {
        const firstArg = remainingArgs[0];
        const cleanArg = firstArg.replace(/^@/, '');

        // Числовой ID
        if (/^-?\d+$/.test(cleanArg)) {
            targetId = cleanArg;
            targetName = cleanArg;
            remainingArgs = remainingArgs.slice(1);
        } else {
            // Юзернейм
            try {
                const telegram = core.get('telegram');
                const client = telegram && telegram.client;
                if (client && typeof client.getEntity === 'function') {
                    const entity = await client.getEntity(cleanArg);
                    if (entity && entity.id) {
                        targetId = entity.id;
                        targetName = entity.firstName || entity.username || cleanArg;
                        remainingArgs = remainingArgs.slice(1);
                    }
                }
            } catch {}
            if (!targetId) {
                targetId = cleanArg;
                targetName = cleanArg;
                remainingArgs = remainingArgs.slice(1);
            }
        }
    }

    return { targetId, targetName, remainingArgs };
}

async function executeTrustUser(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const users = core.get('users');

    const { targetId, targetName, remainingArgs } = await resolveTargetUser(core, { args, message, chatId });

    if (!targetId) {
        await messaging.editMessage(chatId, messageId, '💡 Использование: доверить @пользователь [уровень 1..2] (или ответом на сообщение)');
        return;
    }

    const level = remainingArgs.length > 0 ? (parseInt(remainingArgs[0], 10) || 1) : 1;
    if (level < 1 || level > 2) {
        await messaging.editMessage(chatId, messageId, '❌ Допустимые уровни делегирования: 1 (Доверенный) или 2 (Модератор). Уровень 4 закреплен за владельцем.');
        return;
    }

    try {
        await users.setUserAccessLevel(targetId, level);
        const levelNames = { 1: '1 (Доверенный: утилиты, инфо)', 2: '2 (Модератор: смс, закреп)' };
        await messaging.editMessage(chatId, messageId, `✅ Пользователю ${targetName || targetId} успешно выдан уровень доступа: ${levelNames[level] || level}`);
    } catch (e) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка выдачи прав: ${e.message}`);
    }
}

async function executeRevokeUser(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const users = core.get('users');

    const { targetId, targetName } = await resolveTargetUser(core, { args, message, chatId });

    if (!targetId) {
        await messaging.editMessage(chatId, messageId, '💡 Использование: отозвать @пользователь (или ответом на сообщение)');
        return;
    }

    try {
        await users.setUserAccessLevel(targetId, 0);
        await messaging.editMessage(chatId, messageId, `✅ Права пользователя ${targetName || targetId} полностью отозваны (уровень 0: Guest).`);
    } catch (e) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка отзыва прав: ${e.message}`);
    }
}

async function executeCheckAccess(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const users = core.get('users');

    let checkId = senderId;
    let checkName = 'Вы';

    if ((args && args.length > 0) || (message && message.replyTo)) {
        const resolved = await resolveTargetUser(core, { args, message, chatId });
        if (resolved.targetId) {
            checkId = resolved.targetId;
            checkName = resolved.targetName || checkId;
        }
    }

    try {
        const level = await users.getUserAccessLevel(checkId);
        const ROLE_NAMES = {
            0: '0: Guest (Обычный пользователь, команды игнорируются)',
            1: '1: Trusted (Доверенный: инфо, утилиты, чтение)',
            2: '2: Moderator (Модератор: удаление смс, закреп)',
            3: '3: Admin (Администратор бота)',
            4: '4: Owner (Владелец бота, абсолютный суверенитет)'
        };

        const roleText = ROLE_NAMES[level] || `Неизвестный уровень (${level})`;
        await messaging.editMessage(chatId, messageId, `🔐 Уровень доступа для ${checkName} (\`${checkId}\`):\n${roleText}`);
    } catch (e) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка проверки доступа: ${e.message}`);
    }
}

async function executeListAcl(core, { args, message, chatId, senderId, messageId }) {
    const messaging = core.get('messaging');
    const users = core.get('users');

    try {
        const list = users.getTrustedUsers();
        if (list.length === 0) {
            await messaging.editMessage(chatId, messageId, '📋 Список доверенных пользователей пуст.\nДобавить: `доверить @user [1|2]`');
            return;
        }

        const lines = list.map((u, idx) => {
            const role = u.level === 2 ? 'Модератор' : (u.level === 1 ? 'Доверенный' : `Уровень ${u.level}`);
            return `${idx + 1}. ID: \`${u.id}\` — ${role} (lvl ${u.level})`;
        });

        await messaging.editMessage(chatId, messageId, `👥 Доверенные пользователи бота (${list.length}):\n\n${lines.join('\n')}`);
    } catch (e) {
        await messaging.editMessage(chatId, messageId, `❌ Ошибка получения списка ACL: ${e.message}`);
    }
}

module.exports = {
    name: 'acl',
    version: '1.0.0',
    engine: '^1.0.0',
    requires: ['messaging', 'users'],
    commands: {
        'доверить': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeTrustUser(c, ctx);
            },
            help: 'Делегирование прав: доверить @user [уровень 1..2]',
            aliases: []
        },
        'отозвать': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeRevokeUser(c, ctx);
            },
            help: 'Отзыв прав: отозвать @user',
            aliases: []
        },
        'доступ': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeCheckAccess(c, ctx);
            },
            help: 'Проверка уровня доступа: доступ [@user]',
            aliases: []
        },
        'список_доступа': {
            async handler(first, second, ...rest) {
                const c = (first && typeof first.get === 'function') ? first : coreInstance;
                const ctx = (first && typeof first.get === 'function')
                    ? second
                    : { args: first || [], message: second, chatId: rest[0], senderId: rest[1], messageId: rest[2] };
                return executeListAcl(c, ctx);
            },
            help: 'Список всех доверенных лиц: список_доступа',
            aliases: []
        }
    },
    async init(core) {
        coreInstance = core;
    },
    async stop(core) {
        coreInstance = null;
    }
};
