import { randomPassword } from '@drunk-pulumi/azure/Core/Random';
import { interpolate } from '@pulumi/pulumi';
import Deployment from '../Deployment';
import { createPVCForStorageClass } from '../Storage';
import { MySqlProps } from '../types';

export default ({
  name = 'mysql',
  namespace,
  version = 'latest',
  customPort,
  useClusterIP,
  vaultInfo,
  storageClassName,
  auth,
  ...others
}: MySqlProps) => {
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
    accessMode: 'ReadWriteMany',
    ...others,
    storageClassName,
  });

  const port = 3306;
  const mysql = Deployment({
    name,
    namespace,
    ...others,
    secrets: { MYSQL_ROOT_PASSWORD: password },
    podConfig: {
      ports: { http: port },
      image: `mysql:${version}`,
      volumes: [
        {
          name: 'mysql-data',
          persistentVolumeClaim: persisVolume.metadata.name,
          mountPath: '/var/lib/mysql',
          readOnly: false,
        },
      ],
      podSecurityContext: { runAsGroup: 1001, runAsUser: 1001 },
    },
    deploymentConfig: {
      args: ['--default-authentication-plugin=mysql_native_password'],
    },
    //serviceConfig: { port: customPort || port, useClusterIP },
  });

  return {
    mysql,
    host: interpolate`${name}.${namespace}.svc.cluster.local`,
    port,
    username: 'root',
    password,
  };
};
