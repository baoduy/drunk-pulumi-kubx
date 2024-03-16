import { K8sArgs } from '../types';
import { output } from '@pulumi/pulumi';
import Namespace from '../Core/Namespace';
import DynamicDns, { DynamicDnsProps } from './DynamicDns';
import Tunnel, { TunnelProps } from './Tunnel';
import TunnelHelm, { TunnelHelmProps } from './Tunnel-Helm';
import CertImports, { CloudFlareCertImportProps } from './CertImports';

interface Props extends K8sArgs {
  namespace?: string;

  certImports?: Omit<
    CloudFlareCertImportProps,
    'namespace' | 'provider' | 'dependsOn'
  >;
  dynamicDns?: Omit<DynamicDnsProps, 'namespace' | 'provider' | 'dependsOn'>;
  tunnel?: Omit<
    TunnelProps | TunnelHelmProps,
    'namespace' | 'provider' | 'dependsOn'
  >;
}

export default ({
  namespace = 'cloudflare',
  dynamicDns,
  tunnel,
  certImports,
  ...others
}: Props) => {
  const ns = Namespace({
    name: namespace,
    ...others,
  });

  if (certImports) {
    output(CertImports({ ...others, ...certImports }));
  }
  if (dynamicDns) {
    DynamicDns({ ...others, ...dynamicDns, namespace: ns.metadata.name });
  }
  if (tunnel) {
    if (
      tunnel.parameters.hasOwnProperty('tunnelId') &&
      tunnel.parameters.hasOwnProperty('secret')
    )
      TunnelHelm({
        ...others,
        ...(tunnel as TunnelHelmProps),
        namespace: ns.metadata.name,
      });
    else
      Tunnel({
        ...others,
        ...(tunnel as TunnelProps),
        namespace: ns.metadata.name,
      });
  }
};
