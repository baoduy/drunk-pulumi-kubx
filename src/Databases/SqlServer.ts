import { MySqlProps } from '../types';
import { randomPassword } from '@drunk-pulumi/azure/Core/Random';
import { addCustomSecret } from '@drunk-pulumi/azure/KeyVault/CustomHelper';
import Deployment from '../Deployment';
import { createPVCForStorageClass } from '../Storage';
import { interpolate } from '@pulumi/pulumi';

interface Props extends MySqlProps {
  databaseNames?: string[];
}

export default ({
  name = 'sql',
  namespace,
  databaseNames,
  vaultInfo,
  auth,
  storageClassName,
  provider,
}: Props) => {
  const password = auth?.rootPass
    ? auth.rootPass
    : randomPassword({ name, vaultInfo }).result;

  //Create Storage Container and add Secret to Namespace
  const claim = createPVCForStorageClass({
    name,
    namespace,
    provider,
    storageClassName,
  });

  const sql = Deployment({
    name,
    namespace,
    provider,

    configMap: { MSSQL_PID: 'Developer', ACCEPT_EULA: 'Y' },
    secrets: { SA_PASSWORD: password },

    podConfig: {
      ports: { tcp: 1433 },
      image: 'mcr.microsoft.com/mssql/server:2019-latest',

      securityContext: { fsGroup: 10001 },
      podSecurityContext: {
        allowPrivilegeEscalation: true,
        readOnlyRootFilesystem: false,
        privileged: true,
      },

      resources: {
        requests: { cpu: '1m', memory: '1Gi' },
        limits: { cpu: '500m', memory: '2Gi' },
      },

      volumes: [
        {
          name: 'sqldbs',
          mountPath: '/var/opt/mssql',
          persistentVolumeClaim: claim.metadata.name,
        },
      ],
    },
    deploymentConfig: { replicas: 1 },
    serviceConfig: { usePodPort: true },
  });

  const rs = {
    sql,
    host: interpolate`${name}.${namespace}.svc.cluster.local`,
    username: 'sa',
    password: password,
  };

  if (databaseNames) {
    databaseNames.map((d) => {
      //Create DataBase in the Server
      // new MsSqlDatabaseResource(dbName, {
      //   databaseName: dbName,
      //   server: rs.host,
      //   userName: rs.username,
      //   password: rs.password,
      // });

      if (vaultInfo) {
        //Add Connection String to Key Vault
        addCustomSecret({
          name: d,
          vaultInfo,
          value: interpolate`Data Source=${rs.host};Initial Catalog=${d};User Id=${rs.username};Password=${rs.password};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=True;Connection Timeout=120;`,
          contentType: name,
        });
      }
    });
  }
  return rs;
};
