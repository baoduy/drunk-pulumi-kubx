const fs = require('fs');
const path = require('path');
const Crypto = require('cryptr');

const crypto = new Crypto(
  Buffer.from(
    'b3l0cU5vLXNVUipASlp1WGh1QWhWVnRWbVdAVF9uYzZaNmdAaA==',
    'base64'
  ).toString('utf8')
);

const folder = path.join(__dirname, 'ksconfig');

fs.readdir(folder, (err, files) => {
  if (err) return;

  files.forEach((f) => {
    console.log('encrypt file', f);
    const file = path.join(folder, f);

    const content = fs.readFileSync(file, 'utf8');
    const encryptedString = crypto.encrypt(content);
    fs.writeFileSync(file, encryptedString);
  });
});
