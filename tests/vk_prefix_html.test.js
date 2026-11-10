require('./_no_network.js')(); // сетевой Guard на Windows / unshare на Linux
// Тестирование фикса префикса VK и HTML-декодера (матрица тест-кейсов PRF-01..10, HTML-01..10)
const path = require('path');
const assert = require('assert/strict');
const VkClient = require(path.join(__dirname, '..', 'vk_client.js'));

const results = [];
const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

const OWNER = 777;

function createTestClient(configuredPrefix = '‘') {
    const executed = [];
    const client = new VkClient(
        { settings: { prefix: configuredPrefix } },
        { userToken: 'TEST', proxy: '', prefix: configuredPrefix },
        {
            axios: { create: () => ({ post: async () => ({ data: { response: 1 } }), get: async () => ({ data: {} }) }) },
            log: () => {},
            sleep: async () => {},
            now: () => Date.now()
        }
    );
    client.http = client.createHttp();
    client.ownerId = OWNER;
    client.running = true;

    client.registerCommand('пинг', async (ctx) => {
        executed.push({ cmd: 'пинг', args: ctx.args, rest: ctx.rest });
    });
    client.registerCommand('триггер', async (ctx) => {
        executed.push({ cmd: 'триггер', args: ctx.args, rest: ctx.rest });
    });

    return { client, executed };
}

(async () => {
    console.log('=== БЛОК 1: VK-PREFIX (Семейство апострофов и граничные случаи) ===');

    // PRF-01..04: Семейство апострофов при префиксе '‘' (U+2018)
    {
        const apostrophes = [
            ["'", 'PRF-01: ASCII-апостроф (U+0027)'],
            ['’', 'PRF-02: Правая кавычка iOS (U+2019)'],
            ['ʼ', 'PRF-03: Модификатор апострофа Android (U+02BC)'],
            ['‘', 'PRF-04: Каноническая левая кавычка (U+2018)'],
            ['`', 'PRF-04b: Гравис / обратный апостроф (U+0060)']
        ];

        for (const [char, title] of apostrophes) {
            const { client, executed } = createTestClient('‘');
            const match = client.matchPrefix(`${char}пинг`);
            await client.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: `${char}пинг` });
            check(title, match && match.matched && executed.length === 1 && executed[0].cmd === 'пинг',
                `символ ${char} (U+${char.charCodeAt(0).toString(16)}): вызовов ${executed.length}`);
        }
    }

    // PRF-05: Звездочка '*' как дефолт
    {
        const { client, executed } = createTestClient('*');
        const match = client.matchPrefix('*пинг');
        await client.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: '*пинг' });
        check('PRF-05: Звёздочка * распознаётся при prefix=*', match && executed.length === 1 && executed[0].cmd === 'пинг');
    }

    // PRF-06: Несоответствие: '*' при настроенном '‘', и наоборот
    {
        const { client, executed } = createTestClient('‘');
        const match = client.matchPrefix('*пинг');
        await client.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: '*пинг' });
        check('PRF-06a: *пинг игнорируется, когда настроен префикс ‘', match === null && executed.length === 0);

        const { client: clientStar, executed: execStar } = createTestClient('*');
        const matchApos = clientStar.matchPrefix("'пинг");
        await clientStar.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: "'пинг" });
        check("PRF-06b: 'пинг игнорируется, когда настроен префикс *", matchApos === null && execStar.length === 0);
    }

    // PRF-07: Одиночный символ префикса (пустой body)
    {
        const { client, executed } = createTestClient('‘');
        const res = await client.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: '‘' });
        check('PRF-07: Одиночный символ префикса не роняет бота и не вызывает команду', res === false && executed.length === 0);
    }

    // PRF-08: Префикс с пробелами перед командой
    {
        const { client, executed } = createTestClient('‘');
        await client.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: '‘   пинг' });
        check('PRF-08: Пробелы после префикса («‘   пинг») корректно разбираются', executed.length === 1 && executed[0].cmd === 'пинг');
    }

    // PRF-09: Апостроф в середине обычного слова (д'Артаньян, it's a test)
    {
        const { client, executed } = createTestClient("'");
        const texts = ["д'Артаньян", "it's a test", "o'clock", "don't do it"];
        let triggered = false;
        for (const txt of texts) {
            const m = client.matchPrefix(txt);
            if (m) triggered = true;
            await client.handleMessage({ platform: 'vk', messageId: 1, peerId: 100, fromId: OWNER, out: true, text: txt });
        }
        check("PRF-09: Апострофы в середине слов (д'Артаньян, it's) НЕ запускают роутер команд", !triggered && executed.length === 0);
    }

    // PRF-10: Валидация типов matchPrefix (null, undefined, числа, пустая строка)
    {
        const { client } = createTestClient('‘');
        check('PRF-10: matchPrefix устойчив к null/undefined/числам',
            client.matchPrefix('') === null &&
            client.matchPrefix(null) === null &&
            client.matchPrefix(undefined) === null &&
            client.matchPrefix(12345) === null);
    }

    console.log('\n=== БЛОК 2: VK-HTML (Декодер HTML-сущностей в normalize) ===');

    // HTML-01: Экранированный апостроф в LongPoll (&#39;пинг и &apos;пинг)
    {
        const { client, executed } = createTestClient('‘');
        // update = [4, messageId, flags, peerId, ts, text, extra]
        const rawUpdate1 = [4, 101, 2, 100, 123456, '&#39;пинг', {}];
        const msg1 = client.normalize(rawUpdate1);
        check('HTML-01a: &#39;пинг декодируется в \'пинг', msg1 && msg1.text === "'пинг");
        await client.handleMessage(msg1);
        check('HTML-01b: &#39;пинг вызывает команду пинг', executed.length === 1 && executed[0].cmd === 'пинг');

        const rawUpdate2 = [4, 102, 2, 100, 123456, '&apos;пинг', {}];
        const msg2 = client.normalize(rawUpdate2);
        check('HTML-01c: &apos;пинг декодируется в \'пинг', msg2 && msg2.text === "'пинг");
    }

    // HTML-02: Кавычки в аргументах команды (&quot;)
    {
        const { client, executed } = createTestClient('*');
        const rawUpdate = [4, 103, 2, 100, 123456, '*триггер &quot;привет мир&quot; | ответ 123', {}];
        const msg = client.normalize(rawUpdate);
        check('HTML-02a: normalize декодирует &quot; в чистые кавычки', msg && msg.text === '*триггер "привет мир" | ответ 123');
        await client.handleMessage(msg);
        check('HTML-02b: аргументы команды сохраняют кавычки без HTML-сущностей',
            executed.length === 1 && executed[0].cmd === 'триггер' && executed[0].rest.includes('"привет мир"'));
    }

    // HTML-03: Амперсанд (&amp;)
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 104, 2, 100, 123456, '*фейк Tom &amp; Jerry', {}]);
        check('HTML-03: &amp; декодируется в &', msg && msg.text === '*фейк Tom & Jerry');
    }

    // HTML-04: Угловые скобки (&lt; и &gt;)
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 105, 2, 100, 123456, '*тест &lt;script&gt;alert(1)&lt;/script&gt;', {}]);
        check('HTML-04: &lt; и &gt; декодируются в < и >', msg && msg.text === '*тест <script>alert(1)</script>');
    }

    // HTML-05: Переносы строк (<br>, <br/>, <br />)
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 106, 2, 100, 123456, 'строка1<br>строка2<br/>строка3<br />строка4', {}]);
        check('HTML-05: <br>, <br/>, <br /> декодируются в \\n', msg && msg.text === 'строка1\nстрока2\nстрока3\nстрока4');
    }

    // HTML-06: Защита от двойного декодирования
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 107, 2, 100, 123456, '&amp;quot;не_кавычка&amp;quot;', {}]);
        check('HTML-06: &amp;quot; становится &quot;, а не распаковывается в кавычки', msg && msg.text === '&quot;не_кавычка&quot;');
    }

    // HTML-07: Числовые сущности десятичные и hex (&#65; -> A, &#x42; -> B)
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 108, 2, 100, 123456, '&#65;&#x42;&#x43;', {}]);
        check('HTML-07: Числовые сущности &#65; и &#x42; декодируются в символы ABC', msg && msg.text === 'ABC');
    }

    // HTML-08: Unicode и суррогатные пары (эмодзи)
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 109, 2, 100, 123456, '🏓 &quot;пинг-понг&quot; 🚀', {}]);
        check('HTML-08: Эмодзи сохраняются без повреждения суррогатных пар', msg && msg.text === '🏓 "пинг-понг" 🚀');
    }

    // HTML-09: Пустые и поврежденные сущности (&unknown; &#xyz;)
    {
        const { client } = createTestClient('*');
        const msg = client.normalize([4, 110, 2, 100, 123456, '&unknown; &#xyz; &', {}]);
        check('HTML-09: Невалидные сущности не ломают парсер', msg && msg.text === '&unknown; &#xyz; &');
    }

    // HTML-10: Стресс-тест на длинной строке (50 000 символов, проверка отсутствия ReDoS)
    {
        const { client } = createTestClient('*');
        const chunk = '&quot;тест &amp; проверка&quot;<br>';
        const largeText = chunk.repeat(1500); // ~50кб
        const t0 = Date.now();
        const msg = client.normalize([4, 111, 2, 100, 123456, largeText, {}]);
        const elapsed = Date.now() - t0;
        check(`HTML-10: Стресс-тест 50кб разобран мгновенно за ${elapsed}мс (< 50мс)`, elapsed < 50 && msg && msg.text.startsWith('"тест & проверка"\n'));
    }

    console.log('\n----------------------------------------');
    const fails = results.filter(r => !r).length;
    console.log(fails ? `ИТОГ: ПРОВАЛОВ ${fails} из ${results.length}` : `ИТОГ: ВСЕ ТЕСТЫ ПРОЙДЕНЫ (${results.length} из ${results.length})`);
    process.exit(fails ? 1 : 0);
})().catch(e => {
    console.error('FAIL Исключение в тесте:', e);
    process.exit(1);
});
