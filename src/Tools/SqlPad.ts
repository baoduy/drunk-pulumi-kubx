import * as k8s from '@pulumi/kubernetes';
import { createPVCForStorageClass } from '../Storage';
import Deployment from '../Deployment';
import roleCreator from '@drunk-pulumi/azure/AzAd/Role';
import IdentityCreator from '@drunk-pulumi/azure/AzAd/Identity';
import { Input, interpolate, Resource } from '@pulumi/pulumi';
import { currentEnv, tenantId } from '@drunk-pulumi/azure/Common/AzureEnv';
import { getGraphPermissions } from '@drunk-pulumi/azure/AzAd/GraphDefinition';
import { KeyVaultInfo } from '@drunk-pulumi/azure/types';
import { randomPassword } from '@drunk-pulumi/azure/Core/Random';
import { DefaultKsAppArgs } from '../types';

interface IdentityProps {
  name: string;
  callbackUrl: string;
  vaultInfo?: KeyVaultInfo;
  dependsOn?: Input<Input<Resource>[]> | Input<Resource>;
}

const createIdentity = async ({
  callbackUrl,
  name,
  vaultInfo,
}: IdentityProps) => {
  await roleCreator({
    env: currentEnv,
    appName: name,
    roleName: 'Admin',
  });

  //Create Azure AD Identity for Authentication
  return IdentityCreator({
    name,

    appRoleAssignmentRequired: true,
    appRoles: [
      {
        id: 'c8d15513-8409-4275-86d0-7f6cb8c54997',
        allowedMemberTypes: ['User'],
        description: 'Sql Pad Admin Role',
        displayName: 'Sql Pad Admin Role',
        enabled: true,
        value: 'admin',
      },
      {
        id: '64318876-2259-4e26-8f94-59be1e5232bf',
        allowedMemberTypes: ['User'],
        description: 'Sql Pad User Role',
        displayName: 'Sql Pad User Role',
        enabled: true,
        value: 'editor',
      },
    ],

    requiredResourceAccesses: [
      getGraphPermissions({ name: 'User.Read', type: 'Scope' }),
    ],

    createClientSecret: true,
    createPrincipal: true,

    replyUrls: [callbackUrl],
    vaultInfo,
  });
};

export interface SqlPadProps extends Omit<DefaultKsAppArgs, 'name'> {
  namespace: Input<string>;
  useVirtualHost?: boolean;
  provider: k8s.Provider;

  /**The database configuration follow this instruction: https://getsqlpad.com/en/connections/ */
  databases?: { [key: string]: Input<string> };
  auth: {
    azureAd?: { allowedDomain?: string; vaultInfo: KeyVaultInfo };
    admin?: { email: Input<string> };
  };
  vaultInfo?: KeyVaultInfo;
}

export default async ({
  namespace,
  ingress,
  useVirtualHost,
  databases,
  auth,
  vaultInfo,
  ...others
}: SqlPadProps) => {
  const name = 'sql-pad';
  const hostName = ingress?.hostNames ? ingress.hostNames[0] : '';
  const port = 3000;
  const image = 'sqlpad/sqlpad:latest';
  const callbackUrl = `https://${hostName}/auth/oidc/callback`.toLowerCase();

  const adIdentity = auth?.azureAd
    ? await createIdentity({
        name,
        callbackUrl,
        vaultInfo: auth.azureAd.vaultInfo,
      })
    : undefined;

  const volume = {
    name: 'sqlpad',
    //secretName: 'azure-storage',
    mountPath: '/var/lib/sqlpad',
  };

  createPVCForStorageClass({
    name: volume.name,
    namespace,
    ...others,
  });

  const secrets: Record<string, Input<string>> = {
    SQLPAD_PASSPHRASE: randomPassword({ name, policy: false, vaultInfo })
      .result,

    //localhost used in dev
    //SQLPAD_BASE_URL: '/',
    PUBLIC_URL: hostName,

    SQLPAD_DB_PATH: `/var/lib/sqlpad/sqlDb`,

    // Enable/disable automigration on SQLPad process start. Disable by setting to `false`
    SQLPAD_DB_AUTOMIGRATE: 'true',

    SQLPAD_APP_LOG_LEVEL: 'warn',
    SQLPAD_WEB_LOG_LEVEL: 'error',
  };

  // ======== Authentication =========================
  if (auth.azureAd) {
    //Disable UserName and Password login
    secrets['SQLPAD_USERPASS_AUTH_DISABLED'] = 'true';
    secrets['SQLPAD_OIDC_LINK_HTML'] = 'Sign in with Azure AD';
    secrets['SQLPAD_OIDC_CLIENT_ID'] = adIdentity?.clientId ?? '';
    secrets['SQLPAD_OIDC_CLIENT_SECRET'] = secrets['SQLPAD_OIDC_CLIENT_ID'] =
      adIdentity?.clientId ?? '';

    secrets[
      'SQLPAD_OIDC_ISSUER'
    ] = interpolate`https://login.microsoftonline.com/${tenantId}/v2.0`;
    secrets[
      'SQLPAD_OIDC_AUTHORIZATION_URL'
    ] = interpolate`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
    secrets[
      'SQLPAD_OIDC_TOKEN_URL'
    ] = interpolate`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    secrets[
      'SQLPAD_OIDC_USER_INFO_URL'
    ] = interpolate`https://graph.microsoft.com/oidc/userinfo`;

    secrets['SQLPAD_OIDC_SCOPE'] = 'openid profile email';
    secrets['SQLPAD_ALLOWED_DOMAINS'] = auth.azureAd?.allowedDomain ?? '';
  } else {
    secrets['SQLPAD_ADMIN'] = auth.admin?.email ?? '';
    secrets['SQLPAD_ADMIN_PASSWORD'] = randomPassword({
      name: `${name}-admin`,
      policy: false,
      vaultInfo,
    }).result;
  }

  // ======== Db Connection Strings =========================
  if (databases) {
    Object.keys(databases).map((k) => {
      secrets[`SQLPAD_CONNECTIONS__${k}__name`] = databases[k];
    });
  }

  return Deployment({
    name,
    namespace,
    secrets,

    podConfig: {
      ports: { http: port },
      image,
      //securityContext: defaultSecurityContext,
      //podSecurityContext: defaultPodSecurityContext,
      volumes: [volume],
    },
    deploymentConfig: { replicas: 1, useVirtualHost },

    ingressConfig: ingress
      ? {
          ...ingress,
          hostNames: [hostName],
        }
      : undefined,
    ...others,
  });
};
