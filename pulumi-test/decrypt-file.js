const fs = require('fs');
const Crypto = require('cryptr');
const path = require('path');

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
    console.log('decrypt file', f);
    const file = path.join(folder, f);

    const content = fs.readFileSync(file, 'utf8');
    const encryptedString = crypto.decrypt(content);
    fs.writeFileSync(file, encryptedString);
  });
});
