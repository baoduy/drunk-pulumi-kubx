import { DefaultKsAppArgs } from '../types';
import Deployment from '../Deployment';
import { Input } from '@pulumi/pulumi';
import Identity from '@drunk-pulumi/azure/AzAd/Identity';
import { KeyVaultInfo } from '@drunk-pulumi/azure/types';
import { getGraphPermissions } from '@drunk-pulumi/azure/AzAd/GraphDefinition';

export interface WikiJsProps extends DefaultKsAppArgs {
  vaultInfo?: KeyVaultInfo;
  createAzureAdIdentity?: boolean;
  useVirtualHost?: boolean;
  postgresql: {
    host: Input<string>;
    database: Input<string>;
    username: Input<string>;
    password: Input<string>;
  };
}

export default async ({
  name = 'wiki',
  namespace,
  ingress,
  createAzureAdIdentity,
  useVirtualHost,
  vaultInfo,
  postgresql,
  provider,
}: WikiJsProps) => {
  const hostName = ingress?.hostNames[0];

  const graphAccess = getGraphPermissions(
    { name: 'User.Read.All', type: 'Role' },
    { name: 'User.Read', type: 'Scope' },
    { name: 'email', type: 'Scope' },
    { name: 'openid', type: 'Scope' },
    { name: 'profile', type: 'Scope' }
  );

  const identity = createAzureAdIdentity
    ? Identity({
        name,
        createClientSecret: true,
        vaultInfo,
        allowMultiOrg: false,
        replyUrls: [`https://${hostName}/login/azure/callback`],
        homepage: `https://${hostName}`,
        appType: 'web',
        requiredResourceAccesses: [graphAccess],
      })
    : undefined;

  const wiki = Deployment({
    name,
    namespace,
    provider,

    secrets: {
      DB_TYPE: 'postgres',
      DB_PORT: '5432',
      DB_HOST: postgresql.host,
      DB_USER: postgresql.username,
      DB_PASS: postgresql.password,
      DB_NAME: postgresql.database,
    },

    podConfig: {
      ports: { http: 3000 },
      image: 'requarks/wiki:latest',
      podSecurityContext: { readOnlyRootFilesystem: false },
    },

    deploymentConfig: {
      replicas: 1,
      useVirtualHost,
    },

    ingressConfig: ingress
      ? {
          ...ingress,
          responseHeaders: {
            'Content-Security-Policy': `default-src 'self' *.diagrams.net *.msecnd.net *.services.visualstudio.com data: 'unsafe-inline' 'unsafe-eval'`,
            'referrer-policy': 'no-referrer',
          },
        }
      : undefined,
  });

  return { wiki, identity };
};
