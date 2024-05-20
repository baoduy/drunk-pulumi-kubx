import { K8sArgs } from "../types";
import Namespace from "../Core/Namespace";
import * as k8s from "@pulumi/kubernetes";
import { DeploymentIngress } from "../Deployment";
import { NginxIngress } from "../Ingress";
import { Input, interpolate, output } from "@pulumi/pulumi";
import { getTlsName } from "../CertHelper";
import Role from "@drunk-pulumi/azure/AzAd/Role";
import {
  getDomainFromUrl,
  getRootDomainFromUrl,
} from "@drunk-pulumi/azure/Common/Helpers";
import { IngressProps } from "../Ingress/type";
import identityCreator from "@drunk-pulumi/azure/AzAd/Identity";
import { KeyVaultInfo } from "@drunk-pulumi/azure/types";
import { currentEnv, tenantId } from "@drunk-pulumi/azure/Common/AzureEnv";
import { randomPassword } from "@drunk-pulumi/azure/Core/Random";
import KsSecret from "../Core/KsSecret";

interface Props extends K8sArgs {
  name?: string;
  namespace?: string;
  storageClassName: string;
  redis: { host: Input<string>; port: Input<string>; password: Input<string> };

  auth?: {
    enableAzureAD?: boolean;
  };
  ingressConfig?: {
    hostName: string;
    /* allows to disable ingress if using tunnel */
    enableIngress?: boolean;
  } & Omit<DeploymentIngress, "hostNames">;
  vaultInfo?: KeyVaultInfo;
}

//**
// https://artifacthub.io/packages/helm/bitnami/argo-cd
// */
export default ({
  name = "argo-cd",
  namespace = "argo-cd",
  redis,
  ingressConfig,
  auth,
  storageClassName,
  vaultInfo,
  ...others
}: Props) => {
  const ns = Namespace({ name, ...others });
  const url = `https://${ingressConfig?.hostName}`;
  const adminGroup = Role({
    env: currentEnv,
    appName: name,
    roleName: "Admin",
  });
  const identity = auth?.enableAzureAD
    ? identityCreator({
        name,
        createClientSecret: true,
        createPrincipal: true,
        publicClient: false,
        appType: "web",
        replyUrls: [`${url}/auth/callback`],
        vaultInfo,
      })
    : undefined;

  const secret = KsSecret({
    name: "argo-cd-redis",
    namespace: ns.metadata.name,
    stringData: { "redis-password": redis.password },
    ...others,
  });

  const argoCD = new k8s.helm.v3.Chart(
    name,
    {
      namespace,
      chart: "argo-cd",
      fetchOpts: { repo: "https://charts.bitnami.com/bitnami" },
      skipAwait: true,

      values: {
        global: {
          storageClass: storageClassName,
        },
        config: {
          rbac: {
            "policy.default": "role:readonly",
            "policy.csv": interpolate`g, ${adminGroup.objectId}, role:admin\n`,
          },
          secret: {
            extra: {
              "server.secretkey": randomPassword({
                name: `${name}-secretkey`,
                policy: false,
                vaultInfo,
              }).result,
            },
            argocdServerAdminPassword: randomPassword({
              name: `${name}-admin-password`,
              policy: false,
              length: 25,
              vaultInfo,
            }).result,
          },
        },

        externalRedis: {
          enabled: true,
          ...redis,
          existingSecret: "argo-cd-redis",
        },
        redis: { enabled: false },
        rbac: { create: true },
        dex: { enabled: false },

        server: {
          url,
          config: {
            "admin.enabled": "false",
            "statusbadge.enabled": "true",
            "oidc.config": output({
              name: "AzureAD",
              issuer: interpolate`https://login.microsoftonline.com/${tenantId}/v2.0`,
              clientID: identity?.clientId,
              clientSecret: identity?.clientSecret,
              requestedIDTokenClaims: {
                groups: {
                  essential: true,
                },
              },
              requestedScopes: ["openid", "profile", "email"],
            }).apply(JSON.stringify),
          },
        },
      },
    },
    { dependsOn: ns, provider: others.provider }
  );

  if (ingressConfig?.enableIngress) {
    const ingressProps: IngressProps = {
      ...ingressConfig,
      className: ingressConfig.className || "nginx",

      name: `${name}-ingress`.toLowerCase(),
      hostNames: [ingressConfig.hostName],

      tlsSecretName:
        ingressConfig.tlsSecretName ||
        getTlsName(
          ingressConfig.certManagerIssuer
            ? getDomainFromUrl(ingressConfig.hostName)
            : getRootDomainFromUrl(ingressConfig.hostName),
          Boolean(ingressConfig.certManagerIssuer)
        ),

      proxy: { backendProtocol: "HTTPS" },
      pathType: "ImplementationSpecific",
      service: {
        metadata: { name: "argo-cd-server", namespace },
        spec: { ports: [{ name: "https" }] },
      },
      ...others,
      dependsOn: ns,
    };

    NginxIngress(ingressProps);
  }

  return { argoCD, identity };
};
