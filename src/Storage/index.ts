import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { randomUuId } from '@drunk-pulumi/azure/Core/Random';
import { K8sArgs } from '../types';

const defaultMountOptions = [
  'dir_mode=0777',
  'file_mode=0777',
  'uid=0',
  'gid=0',
  'mfsymlinks',
  'cache=strict',
  'nosharesock',
  'nobrl',
];

interface AzureFileStorageProps {
  //* The azure file share name*/
  name: string;
  resourceGroup?: pulumi.Input<string>;
  secretName: pulumi.Input<string>;
  namespace?: pulumi.Input<string>;

  /** requests storage: 5Gi or 10Gi*/
  storage?: string;
  mountOptions?: string[];
  provider: k8s.Provider;
}

export const createPVCForAzureFileShare = ({
  name,
  resourceGroup,
  namespace,
  secretName,
  storage = '5Gi',
  mountOptions = defaultMountOptions,
  provider,
}: AzureFileStorageProps) => {
  const v = new k8s.core.v1.PersistentVolume(
    name,
    {
      metadata: {
        name,
        namespace,
        annotations: { 'pulumi.com/skipAwait': 'true' },
      },
      spec: {
        capacity: {
          storage,
        },
        accessModes: ['ReadWriteMany'],
        persistentVolumeReclaimPolicy: 'Retain',
        csi: {
          driver: 'file.csi.azure.com',
          readOnly: false,
          volumeHandle: randomUuId(name).result,
          volumeAttributes: resourceGroup
            ? { shareName: name, resourceGroup }
            : { shareName: name },
          nodeStageSecretRef: { name: secretName, namespace },
        },
        mountOptions,
      },
    },
    { provider }
  );

  return new k8s.core.v1.PersistentVolumeClaim(
    name,
    {
      metadata: {
        name,
        namespace,
        annotations: { 'pulumi.com/skipAwait': 'true' },
      },
      spec: {
        accessModes: ['ReadWriteMany'],
        resources: {
          requests: {
            storage,
          },
        },
        storageClassName: '',
        volumeName: v.metadata.name,
      },
    },
    { provider, dependsOn: v }
  );
};

interface StorageClassProps extends K8sArgs {
  name: string;
  namespace?: pulumi.Input<string>;
  storageClassName?: pulumi.Input<string>;
  volumeMode?: 'Filesystem';
  /** requests storage: 5Gi or 10Gi*/
  storageGb?: string;
  //mountOptions?: string[];
  accessMode?: 'ReadWriteOnce' | 'ReadWriteMany';
}

export const createPVCForStorageClass = ({
  name,
  namespace,
  storageClassName = '',
  storageGb = '5Gi',
  accessMode = 'ReadWriteOnce',
  provider,
  dependsOn,
}: StorageClassProps) => {
  return new k8s.core.v1.PersistentVolumeClaim(
    `${name}-claim`,
    {
      metadata: {
        name: `${name}-claim`,
        annotations: { 'pulumi.com/skipAwait': 'true' },
        namespace,
      },
      spec: {
        accessModes: [accessMode],
        resources: {
          requests: {
            storage: storageGb,
          },
        },

        storageClassName,
      },
    },
    { provider, dependsOn, deleteBeforeReplace: true }
  );
};
