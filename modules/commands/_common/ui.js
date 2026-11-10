'use strict';

/**
 * UI / UX Standard Helper for LP-Bot Commands
 * Provides consistent layout, divider frames, error banners, and smart edit/reply handling.
 */

const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

/**
 * Parse arguments and invocation context whether called via new modular core or legacy signature
 */
function parseContext(coreOrArgs, ctxOrMessage, ...rest) {
    let args, message, chatId, senderId, messageId;
    if (coreOrArgs && typeof coreOrArgs.get === 'function') {
        const ctx = ctxOrMessage || {};
        args = Array.isArray(ctx.args) ? ctx.args : [];
        message = ctx.message;
        chatId = ctx.chatId;
        senderId = ctx.senderId;
        messageId = ctx.messageId;
    } else {
        args = Array.isArray(coreOrArgs) ? coreOrArgs : [];
        message = ctxOrMessage;
        chatId = rest[0];
        senderId = rest[1];
        messageId = rest[2];
    }
    return { args, message, chatId, senderId, messageId };
}

/**
 * Render a beautiful detailed manual card for commands called without arguments or on syntax error
 */
function renderManual({ title, command, description, usage = [], examples = [], flags = [], notes = [] }) {
    const pTitle = title || (command ? `КОМАНДА: ${command.toUpperCase()}` : 'ИНСТРУКЦИЯ');
    let out = `📖 ${pTitle}\n${DIVIDER}\n`;

    if (description) {
        out += `📝 Описание: ${description}\n\n`;
    }

    if (usage && usage.length) {
        out += `⌨️ Формат вызова:\n`;
        const list = Array.isArray(usage) ? usage : [usage];
        list.forEach((u) => {
            out += `   🔹 ${u}\n`;
        });
        out += `\n`;
    }

    if (examples && examples.length) {
        out += `💡 Примеры использования:\n`;
        examples.forEach((ex) => {
            if (typeof ex === 'string') {
                out += `   • ${ex}\n`;
            } else if (ex.cmd) {
                out += `   • ${ex.cmd}${ex.desc ? ` — ${ex.desc}` : ''}\n`;
            }
        });
        out += `\n`;
    }

    if (flags && flags.length) {
        out += `⚙️ Параметры и флаги:\n`;
        flags.forEach((f) => {
            if (typeof f === 'string') {
                out += `   • ${f}\n`;
            } else if (f.flag) {
                out += `   • ${f.flag}${f.desc ? ` — ${f.desc}` : ''}\n`;
            }
        });
        out += `\n`;
    }

    if (notes && notes.length) {
        const nList = Array.isArray(notes) ? notes : [notes];
        nList.forEach((n) => {
            out += `📌 ${n}\n`;
        });
    }

    out += `${DIVIDER}`;
    return out;
}

/**
 * Render error banner
 */
function renderError({ title, command, error, hint }) {
    const pTitle = title || (command ? `ОШИБКА: ${command}` : 'ОШИБКА');
    let out = `❌ ${pTitle}\n${DIVIDER}\n`;
    if (error) out += `⚠️ Причина: ${error}\n`;
    if (hint) out += `💡 Подсказка: ${hint}\n`;
    out += `${DIVIDER}`;
    return out;
}

/**
 * Render success banner
 */
function renderSuccess({ title, items = [], notes = [] }) {
    let out = `✅ ${title || 'УСПЕШНО'}\n${DIVIDER}\n`;
    if (Array.isArray(items)) {
        items.forEach((it) => {
            out += `• ${it}\n`;
        });
    } else if (typeof items === 'string') {
        out += `${items}\n`;
    }

    if (notes && notes.length) {
        out += `\n`;
        const nList = Array.isArray(notes) ? notes : [notes];
        nList.forEach((n) => {
            out += `💡 ${n}\n`;
        });
    }
    out += `${DIVIDER}`;
    return out;
}

/**
 * Send response respecting edit vs reply mode
 */
async function sendOutput(core, ctx, text, options = {}) {
    const messaging = core.get('messaging');
    const settings = core.get('settings');
    const replyMode = options.replyMode || (settings && typeof settings.get === 'function' ? (settings.get('responseMode') || settings.get('reply_mode') || 'edit') : 'edit');

    const canEdit = Boolean(ctx.message && ctx.message.out && ctx.messageId);

    if (replyMode === 'edit' && canEdit && typeof messaging.editMessage === 'function') {
        try {
            return await messaging.editMessage(ctx.chatId, ctx.messageId, text);
        } catch {
            // fallback to send
        }
    }

    if (typeof messaging.sendMessage === 'function') {
        const sendOpts = {
            replyTo: ctx.messageId,
            ...options
        };
        return await messaging.sendMessage(ctx.chatId, text, sendOpts);
    }
}

module.exports = {
    DIVIDER,
    parseContext,
    renderManual,
    renderError,
    renderSuccess,
    sendOutput
};
