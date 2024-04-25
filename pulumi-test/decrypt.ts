import Crypto from 'cryptr';
import * as configHelper from '@drunk-pulumi/azure/Common/ConfigHelper';
import * as fs from 'fs';

export const decryptFile = (filePath: string) => {
  const pass = configHelper.requireSecret('encrypt-pass');

  return new Promise<string>((rs) => {
    pass.apply((p) => {
      const crypto = new Crypto(p);
      const content = fs.readFileSync(filePath, { encoding: 'utf8' });
      rs(crypto.decrypt(content));
    });
  });
};
