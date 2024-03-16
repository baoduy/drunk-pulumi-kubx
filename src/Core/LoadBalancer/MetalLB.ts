import * as k8s from '@pulumi/kubernetes';
import { K8sArgs } from '../../types';
import Namespace from '../Namespace';

export interface MetalLBProps extends K8sArgs {
  version?: string;
}

export default ({
  version,

  ...others
}: MetalLBProps) => {
  const name = 'metallb';
  const namespace = 'metallb';
  const ns = Namespace({ name: namespace, ...others });

  //Deployment
  return new k8s.helm.v3.Chart(
    name,
    {
      namespace,
      chart: 'metallb',
      version,
      fetchOpts: {
        repo: 'https://charts.bitnami.com/bitnami',
      },
      skipAwait: true,
      values: {},
    },
    { provider: others.provider, dependsOn: ns }
  );
};
