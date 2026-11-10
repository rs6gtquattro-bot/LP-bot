# Модули LP Bot — формат модуля

Положи папку с `index.js` в `modules/`, экспортируй объект и перезапусти бота:

```js
module.exports = {
  name: 'example',
  version: '1.0.0',
  engine: '^1.0.0',
  requires: ['messaging', 'telegram'], // имена модулей, не пути файлов
  commands: {
    example: {
      async handler(core, { args, message, chatId, senderId, messageId }) {
        return 'Ответ';
      },
      help: 'Описание команды',
      aliases: ['пример']
    }
  },
  async init(core) {},
  async stop(core) {}
};
```

Подробная документация: `docs/modules.md`.
