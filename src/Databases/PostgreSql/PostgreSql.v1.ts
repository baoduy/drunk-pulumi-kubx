import { randomPassword } from '@drunk-pulumi/azure/Core/Random';
import { interpolate } from '@pulumi/pulumi';
import Deployment from '../../Deployment';
import { createPVCForStorageClass } from '../../Storage';
import { PostgreSqlProps } from '../../types';

export default ({
  name = 'postgres',
  namespace,
  vaultInfo,
  storageClassName,
  auth,
  ...others
}: PostgreSqlProps) => {
  const password =
    auth?.rootPass ||
    randomPassword({
      name,
      length: 25,
      policy: false,
      options: { special: false },
      vaultInfo,
    }).result;

  const persisVolume = createPVCForStorageClass({
    name,
    namespace,
    //accessMode: 'ReadWriteMany',
    ...others,
    storageClassName,
  });

  const port = 5432;
  const postgrSsql = Deployment({
    name,
    namespace,
    ...others,
    secrets: { POSTGRES_PASSWORD: password },
    podConfig: {
      ports: { http: port },
      image: `postgres:latest`,
      volumes: [
        {
          name: 'data',
          persistentVolumeClaim: persisVolume.metadata.name,
          mountPath: '/var/lib/postgresql/data',
          subPath: 'data',
          readOnly: false,
        },
      ],
      //podSecurityContext: { runAsGroup: 0, runAsUser: 0, runAsNonRoot: false },
    },
    deploymentConfig: {
      //args: ['/bin/chown', '-R', '1001', '/var/lib/postgresql/data'],
    },
    serviceConfig: { usePodPort: true },
  });

  return {
    postgrSsql,
    host: interpolate`${name}.${namespace}.svc.cluster.local`,
    port,
    username: 'postgres',
    password,
  };
};
