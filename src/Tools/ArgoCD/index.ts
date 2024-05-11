import { K8sArgs } from "../../types";
import Namespace from "../../Core/Namespace";
import * as k8s from "@pulumi/kubernetes";
import { DeploymentIngress } from "../../Deployment";
import { NginxIngress } from "../../Ingress";
import { interpolate } from "@pulumi/pulumi";
import { getTlsName } from "../../CertHelper";
import {
  getDomainFromUrl,
  getRootDomainFromUrl,
  toBase64,
} from "@drunk-pulumi/azure/Common/Helpers";
import { IngressProps } from "../../Ingress/type";
import identityCreator from "@drunk-pulumi/azure/AzAd/Identity";
import { KeyVaultInfo } from "@drunk-pulumi/azure/types";
import { tenantId } from "@drunk-pulumi/azure/Common/AzureEnv";
import { randomPassword } from "@drunk-pulumi/azure/Core/Random";

interface Props extends K8sArgs {
  name?: string;
  namespace?: string;
  storageClassName: string;
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
  ingressConfig,
  auth,
  storageClassName,
  vaultInfo,
  ...others
}: Props) => {
  const ns = Namespace({ name, ...others });
  const url = `https://${ingressConfig?.hostName}`;
  const identity = auth?.enableAzureAD
    ? identityCreator({
        name,
        createClientSecret: true,
        createPrincipal: true,
        publicClient: false,
        appType: "web",
        replyUrls: [`${url}/argo-cd/auth/callback`],
        vaultInfo,
      })
    : undefined;

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
          secret: {
            argocdServerAdminPassword: randomPassword({
              name: `${name}-admin-password`,
              policy: false,
              length: 25,
              vaultInfo,
            }).result,
          },
        },

        // redis: {
        //   auth: {
        //     existingSecret: randomPassword({
        //       name: `${name}-redis-pass`,
        //       policy: false,
        //     }).result,
        //   },
        // },
        rbac: { create: true },
        //SSO
        dex: {
          image: { tag: "v2.30.2" },
          enabled: auth?.enableAzureAD,
          // extraEnvVars: [
          //   { name: 'ARGOCD_DEX_SERVER_DISABLE_TLS', value: 'true' },
          // ],
        },
        server: {
          url,
          //DEX config
          config: identity
            ? {
                "dex.config": interpolate`connectors:\n- type: microsoft\n  id: microsoft\n  name:  Azure AD\n  config:\n    clientID: ${identity.clientId}\n    clientSecret: ${identity.clientSecret}\n    redirectURI: ${url}/api/dex/callback\n    tenant: ${tenantId}\n    groups:\n      - AKS-Cluster-Admin\n`,
              }
            : undefined,

          //Ingress
          // ingress: ingressConfig
          //   ? {
          //       enabled: true,
          //       hostname: ingressConfig.hostName,
          //       ingressClassName: ingressConfig.className || 'nginx',
          //     }
          //   : undefined,
        },
      },

      transformations: [
        (o, op) => {
          if (o.kind === "Secret") {
            if (o.metadata.name === "argocd-secret") {
              o.data["server.secretkey"] = randomPassword({
                name: `${name}-secretkey`,
                policy: false,
                vaultInfo,
              }).result.apply(toBase64);

              if (identity)
                o.data["oidc.azure.clientSecret"] =
                  identity.clientSecret?.apply(toBase64);

              //Ignore fields
              op.ignoreChanges = ["admin.password", "admin.passwordMtime"];
            }

            if (o.metadata.name === "argo-cd-redis") {
              o.data["redis-password"] = randomPassword({
                name: `${name}-redis-password`,
                policy: false,
                options: { special: false },
              }).result.apply(toBase64);
            }
          }
        },
      ],
    },
    { dependsOn: ns, provider: others.provider },
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
          Boolean(ingressConfig.certManagerIssuer),
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
};
