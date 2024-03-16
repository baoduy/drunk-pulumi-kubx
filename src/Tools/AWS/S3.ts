import deployment from '../../Deployment';
import { DefaultKsAppArgs } from '../../types';
import { createPVCForStorageClass } from '../../Storage';

export interface AwsS3Props extends Omit<DefaultKsAppArgs, 'name'> {
  storageClassName: string;
}

export default ({
  namespace,
  ingress,
  runAs,
  storageClassName,
  ...others
}: AwsS3Props) => {
  const name = 'aws-s3';
  const image = 'scireum/s3-ninja:latest';

  //Storage
  const persisVolume = createPVCForStorageClass({
    name,
    namespace,
    accessMode: 'ReadWriteMany',
    ...others,
    storageClassName,
  });

  deployment({
    name,
    namespace,

    podConfig: {
      ports: { http: 9000 },
      image,
      resources: {
        requests: { memory: '1Mi', cpu: '1m' },
        limits: {
          memory: '1Gi',
          cpu: '1',
        },
      },
      // securityContext: runAs,
      volumes: [
        {
          name: 'data',
          mountPath: '/home/sirius/data',
          subPath: 'sample',
          persistentVolumeClaim: persisVolume.metadata.name,
        },
      ],
    },
    ingressConfig: ingress,
    deploymentConfig: { replicas: 1 },

    ...others,
  });
};
