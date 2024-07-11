import Namespace from "./Namespace";
import Nginx, { IngressClassTypes, NginxHelmProps } from "./Nginx";
import Monitoring, { MonitoringProps } from "./Monitoring";
import CertManager, { CertManagerProps } from "./CertManager";
import { Input, Resource } from "@pulumi/pulumi";
import StorageClass, { StorageClassProps } from "./StorageClass";
import { K8sArgs } from "../types";
import MetalLB, { MetalLBProps } from "./LoadBalancer/MetalLB";
import Longhorn, { LonghornProps } from "../Storage/Longhorn";

interface NginxItemProps {
  name: string;
  ingressClass: IngressClassTypes;

  /** Either public IP address or private IpAddress MUST be provided. */
  publicIpAddress?: string;
  /** Use this in case the ingress behind a firewall */
  internalIpAddress?: string;

  props?: Omit<
    NginxHelmProps,
    | "namespace"
    | "ingressClass"
    | "name"
    | "provider"
    | "resources"
    | "version"
    | "network"
  >;
}

interface NginxProps {
  namespace: string;
  version?: string;
  vnetResourceGroup?: string;
  //Auto detect based on IpAddress Type
  //internalALBIngress?: boolean;

  public?: NginxItemProps;
  private?: Omit<NginxItemProps, "publicIpAddress">;
}

interface Props extends K8sArgs {
  namespaces: Array<{
    name: string;
    labels?: {
      [key: string]: string;
    };
  }>;
  metalLb?: Omit<MetalLBProps, "provider" | "dependsOn">;
  longhorn?: Omit<LonghornProps, "provider" | "dependsOn">;
  nginx?: NginxProps;
  monitoring?: Omit<MonitoringProps, "provider" | "dependsOn">;
  certManager?: Omit<CertManagerProps, "namespace" | "provider" | "dependsOn">;
  storageClasses?: {
    [key: string]: Omit<StorageClassProps, "provider" | "name">;
  };
  enableStaticIpEgress?: { publicIpAddress?: Input<string> };
}

export default async ({
  namespaces,
  provider,
  dependsOn,
  metalLb,
  longhorn,
  nginx,
  monitoring,
  certManager,
  storageClasses,
}: Props) => {
  //Create Namespaces
  const namespacesList = namespaces.map((n) => Namespace({ ...n, provider }));
  const resources = new Array<Resource>();

  if (metalLb) {
    const lb = MetalLB({ ...metalLb, provider, dependsOn });
    resources.push(lb);
  }

  if (nginx) {
    const rs = nginxCreator({ ...nginx, provider, dependsOn: resources });
    if (rs.publicIngress) resources.push(rs.publicIngress);
    if (rs.privateIngress) resources.push(rs.privateIngress);
  }

  if (storageClasses) {
    Object.keys(storageClasses).forEach((k) => {
      const c = storageClasses[k];
      if (!c) return undefined;
      return StorageClass({ provider, ...c });
    });
  }

  if (certManager) {
    resources.push(
      CertManager({
        ...certManager,
        provider,
        dependsOn: resources,
      }),
    );
  }

  if (monitoring) {
    resources.push(await Monitoring({ ...monitoring, provider, dependsOn }));
  }

  if (longhorn) {
    resources.push(Longhorn({ ...longhorn, provider, dependsOn }));
  }
  return { namespacesList, resources };
};

const nginxCreator = ({
  namespace,
  version,
  vnetResourceGroup,
  provider,

  ...info
}: NginxProps & K8sArgs) => {
  //Namespace
  const ns = Namespace({ name: namespace, provider });
  let privateIngress: Resource | undefined;
  let publicIngress: Resource | undefined;

  if (info.public) {
    //Public
    publicIngress = Nginx({
      ...info.public.props,

      name: info.public.name,
      version,
      namespace,
      ingressClass: "public",

      network: {
        internalALBIngress: Boolean(info.public.internalIpAddress),
        vnetResourceGroup,
        loadBalancerIP:
          info.public.publicIpAddress || info.public.internalIpAddress,
      },
      provider,
      dependsOn: ns,
    });
  }

  if (info.private) {
    //Private
    privateIngress = Nginx({
      ...info.private.props,

      name: info.private.name,
      version,
      namespace,
      ingressClass: "private",

      network: {
        internalALBIngress: true,
        vnetResourceGroup,
        loadBalancerIP: info.private.internalIpAddress,
      },
      provider,
      dependsOn: ns,
    });
  }

  return { publicIngress, privateIngress };
};
