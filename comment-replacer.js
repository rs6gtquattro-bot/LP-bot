const fs = require('fs');
const readline = require('readline');

// Функция для замены слов в комментариях
function replaceInComments(code, oldWord, newWord) {
  const commentRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  
  return code.replace(commentRegex, (comment) => {
    return comment.replace(new RegExp(oldWord, 'gi'), newWord);
  });
}

// Создаем интерфейс для чтения ввода
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Основная функция
function main() {
  console.log('=== Замена слов в комментариях JavaScript ===\n');
  
  // Читаем исходный файл
  fs.readFile('script.js', 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения файла script.js:', err);
      rl.close();
      return;
    }

    console.log('Текущее содержимое script.js:');
    console.log('----------------------------------------');
    console.log(data);
    console.log('----------------------------------------\n');

    // Запрашиваем у пользователя данные
    rl.question('Введите слово для поиска (в комментариях): ', (oldWord) => {
      rl.question('Введите слово для замены: ', (newWord) => {
        
        // Выполняем замену
        const modifiedCode = replaceInComments(data, oldWord, newWord);
        
        // Показываем разницу
        console.log('\nРезультат замены:');
        console.log('----------------------------------------');
        console.log(modifiedCode);
        console.log('----------------------------------------\n');
        
        // Предлагаем сохранить изменения
        rl.question('Сохранить изменения в script.js? (y/n): ', (answer) => {
          if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            // Сохраняем изменения
            fs.writeFile('script.js', modifiedCode, 'utf8', (writeErr) => {
              if (writeErr) {
                console.error('Ошибка сохранения файла:', writeErr);
              } else {
                console.log('✅ Изменения успешно сохранены в script.js!');
              }
              rl.close();
            });
          } else {
            console.log('❌ Изменения не сохранены.');
            rl.close();
          }
        });
      });
    });
  });
}

// Запускаем программу
main();