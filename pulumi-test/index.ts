import CloudFlare from '@drunk-pulumi/kubx/CloudFlare';
import { createProvider } from '@drunk-pulumi/kubx/Providers';
import { decryptFile } from './decrypt';
import * as pulumi from '@pulumi/pulumi';
import { requireSecret} from "@drunk-pulumi/azure/Common/ConfigHelper";

const rs = (async () => {
  const provider = createProvider({
    name: 'ks-provider',
    kubeconfig: await decryptFile(`./ksconfig/st-k3s.config`),
  });

  //CloudFlare Cert Import
  const cloudflare = [
    {
      apiKey: requireSecret('cf-token'),
      zones: [ 'drunkcoding.net'],
    },
  ];

  CloudFlare({
    certImports: {
      namespaces: ['cloudflare'],
      cloudflare,
    },
    provider
  });
})();

export default pulumi.output(rs);
