/**
 * tools/release_hash.js
 * Расчет контрольных сумм SHA-256 для релизных файлов на GitHub Releases.
 * Генерирует dist/SHA256SUMS.txt и dist/RELEASE_HASHES.md
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version } = require('../package.json');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('===============================================================');
console.log(`     РАСЧЕТ КОНТРОЛЬНЫХ СУММ SHA-256 ДЛЯ РЕЛИЗА LP-bot v${version}`);
console.log('===============================================================\n');

if (!fs.existsSync(distDir)) {
    console.error('❌ ОШИБКА: Директория dist/ не найдена. Сначала соберите релиз.');
    process.exit(1);
}

function calculateSha256(filePath) {
    const hash = crypto.createHash('sha256');
    const buffer = fs.readFileSync(filePath);
    hash.update(buffer);
    return hash.digest('hex');
}

const entries = fs.readdirSync(distDir, { withFileTypes: true });
const targetExtensions = ['.exe', '.zip', '.tar.gz'];

const releaseFiles = entries
    .filter(e => e.isFile() && targetExtensions.some(ext => e.name.toLowerCase().endsWith(ext)))
    .filter(e => !e.name.toLowerCase().includes('sha256') && !e.name.toLowerCase().includes('debug'))
    .map(e => e.name)
    .sort();

if (releaseFiles.length === 0) {
    console.warn('⚠️ В dist/ не найдено релизных бинарников для хеширования.');
    process.exit(0);
}

const hashes = [];
const linesSha256 = [];

for (const fileName of releaseFiles) {
    const fullPath = path.join(distDir, fileName);
    const stat = fs.statSync(fullPath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    const sha256 = calculateSha256(fullPath);

    hashes.push({ name: fileName, size: sizeMb, sha256 });
    linesSha256.push(`${sha256}  ${fileName}`);

    console.log(`📦 ${fileName}`);
    console.log(`   Размер: ${sizeMb} МБ`);
    console.log(`   SHA-256: ${sha256}\n`);
}

// Запись стандартного файла SHA256SUMS.txt
const sumsFilePath = path.join(distDir, 'SHA256SUMS.txt');
fs.writeFileSync(sumsFilePath, linesSha256.join('\n') + '\n', 'utf8');
console.log(`✅ Файл контрольных сумм сохранён: ${sumsFilePath}`);

// Запись файла для описания GitHub Release (Markdown таблица)
const mdContent = `# Релизные файлы LP-bot v${version}

| Файл | Размер | Контрольная сумма SHA-256 |
| :--- | :--- | :--- |
${hashes.map(h => `| \`${h.name}\` | ${h.size} МБ | \`${h.sha256}\` |`).join('\n')}

### Верификация целостности:
\`\`\`bash
sha256sum -c SHA256SUMS.txt
\`\`\`
`;

const mdFilePath = path.join(distDir, 'RELEASE_HASHES.md');
fs.writeFileSync(mdFilePath, mdContent, 'utf8');
console.log(`✅ Markdown сводка для GitHub Releases сохранена: ${mdFilePath}`);
console.log('===============================================================\n');
