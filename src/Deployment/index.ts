import * as k8s from '@pulumi/kubernetes';
import * as kx from '../kx';
import { NginxIngress, TraefikIngress } from '../Ingress';
import * as pulumi from '@pulumi/pulumi';
import { Input, output, Resource } from '@pulumi/pulumi';
import { getDomainFromUrl, getRootDomainFromUrl } from '@drunk-pulumi/azure/Common/Helpers';
import { getTlsName } from '../CertHelper';
import { IngressProps } from '../Ingress/type';
import { input as inputs } from '@pulumi/kubernetes/types';
import { PodAutoScale, PodAutoScaleProps } from './PodAutoscaler';
import ConfigSecret from '../ConfigSecret';

type restartPolicies = 'Always' | 'OnFailure' | 'Never';

export const defaultResources = {
  limits: { memory: '0.5Gi', cpu: '500m' },
  requests: { memory: '10Mi', cpu: '1m' },
};

export const virtualHostConfig = {
  nodeSelector: {
    'kubernetes.io/role': 'agent',
    'beta.kubernetes.io/os': 'linux',
    type: 'virtual-kubelet',
  },
  tolerations: [
    {
      effect: 'NoSchedule',
      key: 'virtual-kubelet.io/provider',
      value: 'azure',
    },
  ],
};

interface PodConfigProps {
  ports: kx.types.PortMap;
  image: Input<string>;
  imagePullSecret?: string;
  imagePullPolicy?: 'Always' | 'Never' | 'IfNotPresent';
  resources?: Input<k8s.types.input.core.v1.ResourceRequirements> | false;
  command?: string[];
  volumes?: Array<{
    name: string;
    mountPath: string;
    emptyDir?: boolean;
    subPath?: string;
    hostPath?: string;
    readOnly?: boolean;
    /** The secret name */

    secretName?: Input<string>;
    configMapName?: Input<string>;

    /** The volume claims name */
    persistentVolumeClaim?: Input<string>;
    type?: 'azureFile';
  }>;
  podSecurityContext?: Input<k8s.types.input.core.v1.SecurityContext>;
  securityContext?: Input<k8s.types.input.core.v1.PodSecurityContext>;
  tolerations?: pulumi.Input<inputs.core.v1.Toleration>[];
  nodeSelector?: pulumi.Input<{
    [key: string]: pulumi.Input<string>;
  }>;
  probes?: {
    liveness?: {
      httpGet: string;
      port: number;
      initialDelaySeconds?: number;
      periodSeconds?: number;
      timeoutSeconds?: number;
      failureThreshold?: number;
    };
    lifecycle?: { postStart?: pulumi.Input<string>[] };
  };
}

interface PodBuilderProps {
  name: string;
  envFrom: Array<k8s.types.input.core.v1.EnvFromSource>;
  useVirtualHost?: boolean;
  podConfig: PodConfigProps;
  args?: Input<string>[];
  restartPolicy?: restartPolicies;
}

const buildPod = ({
  name,
  envFrom,
  podConfig,
  useVirtualHost,
  restartPolicy,
  args,
}: PodBuilderProps) => {
  //console.log('buildPod', podConfig);
  if (useVirtualHost) {
    podConfig.nodeSelector = virtualHostConfig.nodeSelector;
    podConfig.tolerations = virtualHostConfig.tolerations;

    if (!podConfig.resources) podConfig.resources = false;
  }
  //else if (!podConfig.nodeSelector) podConfig.nodeSelector = { app: name };

  const resources =
    podConfig.resources === false
      ? undefined
      : podConfig.resources || defaultResources;

  return new kx.PodBuilder({
    terminationGracePeriodSeconds: 30,

    securityContext: podConfig.securityContext,
    automountServiceAccountToken: false,

    volumes: podConfig.volumes
      ? podConfig.volumes.map((v) => ({
          name: v.name.toLowerCase(),
          emptyDir: v.emptyDir ? {} : undefined,
          hostPath: v.hostPath ? { path: v.hostPath } : undefined,
          csi:
            v.secretName && v.type === 'azureFile'
              ? {
                  driver: 'file.csi.azure.com',
                  volumeAttributes: {
                    secretName: v.secretName,
                    shareName: v.name.toLowerCase(),
                    // mountOptions:
                    //   'dir_mode=0777,file_mode=0777,cache=strict,actimeo=30',
                  },
                }
              : undefined,

          persistentVolumeClaim: v.persistentVolumeClaim
            ? { claimName: v.persistentVolumeClaim }
            : undefined,

          configMap: v.configMapName ? { name: v.configMapName } : undefined,
          secret:
            v.secretName && v.type === undefined
              ? { secretName: v.secretName }
              : undefined,
        }))
      : undefined,

    containers: [
      {
        name,
        image: podConfig.image,
        imagePullPolicy: podConfig.imagePullPolicy,
        ports: podConfig.ports,
        command: podConfig.command,
        envFrom,

        securityContext: podConfig.podSecurityContext,
        resources,
        args,

        volumeMounts: podConfig.volumes
          ? podConfig.volumes.map((v) => ({
              name: v.name,
              mountPath: v.mountPath,
              subPath: v.subPath,
              readOnly: v.readOnly ?? false,
            }))
          : undefined,

        livenessProbe: podConfig.probes?.liveness
          ? {
              initialDelaySeconds:
                podConfig.probes.liveness.initialDelaySeconds || 30,
              periodSeconds: podConfig.probes.liveness.periodSeconds || 300,
              timeoutSeconds: podConfig.probes.liveness.timeoutSeconds || 5,
              failureThreshold: podConfig.probes.liveness.failureThreshold || 2,

              httpGet: podConfig.probes.liveness.httpGet
                ? {
                    path: podConfig.probes.liveness.httpGet,
                    port: podConfig.probes.liveness.port,
                  }
                : undefined,
            }
          : undefined,

        lifecycle: podConfig.probes?.lifecycle?.postStart
          ? {
              postStart: {
                exec: { command: podConfig.probes.lifecycle.postStart },
              },
            }
          : undefined,
      },
    ],
    imagePullSecrets: podConfig.imagePullSecret
      ? [
          {
            name: podConfig.imagePullSecret,
          },
        ]
      : undefined,
    restartPolicy,

    tolerations: podConfig.tolerations,
    nodeSelector: podConfig.nodeSelector,
  });
};

export type DeploymentIngress = Omit<
  IngressProps,
  'name' | 'internalIngress' | 'service' | 'services' | 'provider' | 'dependsOn'
>;

export type IngressTypes = 'nginx' | 'traefik';

interface Props {
  name: string;
  namespace: Input<string>;
  podConfig: PodConfigProps;

  deploymentConfig?:
    | {
        args?: Input<string>[];
        replicas?: number;
        /** Run App and Jobs using Virtual Node **/
        useVirtualHost?: boolean;
        //strategy?: 'Recreate' | 'RollingUpdate';
        /** Enforce resources to be redeployed everytime */
        enforceReDeployment?: boolean;
      }
    | false;

  serviceConfig?:
    | {
        usePodPort?: boolean;
        //port?: number;
        useClusterIP?: boolean;
      }
    | false;

  jobConfigs?: Array<{
    name: string;
    /** Run Jobs using Virtual Node **/
    useVirtualHost?: boolean;
    /**If schedule provided the cron job will be created instead just a job*/
    cron?: {
      schedule: string;
      failedJobsHistoryLimit?: number;
      successfulJobsHistoryLimit?: number;
      concurrencyPolicy: 'Forbid' | 'Allow' | 'Replace';
    };

    args?: Input<string>[];
    restartPolicy?: restartPolicies;
    ttlSecondsAfterFinished?: number;
  }>;

  ingressConfig?: { type: IngressTypes } & DeploymentIngress;

  configMap?: Input<{
    [key: string]: Input<string>;
  }>;
  secrets?: Input<{
    [key: string]: Input<string>;
  }>;
  mapConfigToVolume?: { name: string; path: string; subPath?: string };
  mapSecretsToVolume?: { name: string; path: string; subPath?: string };

  /**
   * Enable high availability for the deployment. Multi instance of the pod will be scale up and down based on the usage.
   */
  enableHA?: Omit<PodAutoScaleProps, 'provider' | 'deployment'>;
  provider: k8s.Provider;
  dependsOn?: Input<Input<Resource>[]> | Input<Resource>;
}

export default ({
  name,
  namespace,

  configMap,
  secrets,
  mapSecretsToVolume,
  mapConfigToVolume,

  podConfig,
  deploymentConfig,
  serviceConfig,
  jobConfigs,
  ingressConfig,

  enableHA,
  provider,
  dependsOn,
}: Props) => {
  const deploymentTime =
    typeof deploymentConfig === 'object' && deploymentConfig.enforceReDeployment
      ? new Date().getTime().toString()
      : '';

  if (!podConfig.volumes) podConfig.volumes = [];
  const configSecret = ConfigSecret({
    name,
    namespace,
    configMap,
    secrets,
    provider,
    dependsOn,
  });
  const envFrom = new Array<k8s.types.input.core.v1.EnvFromSource>();

  if (configSecret.config) {
    envFrom.push({
      configMapRef: { name: configSecret.config.metadata.name },
    });
  }

  if (configSecret.secret) {
    //Create Secrets
    envFrom.push({ secretRef: { name: configSecret.secret.metadata.name } });
  }

  if (mapConfigToVolume && configSecret.config) {
    podConfig.volumes.push({
      name: mapConfigToVolume.name,
      mountPath: mapConfigToVolume.path,
      subPath: mapConfigToVolume.subPath,
      configMapName: configSecret.config.metadata.name,
    });
  }
  if (mapSecretsToVolume && configSecret.secret) {
    podConfig.volumes.push({
      name: mapSecretsToVolume.name,
      mountPath: mapSecretsToVolume.path,
      subPath: mapSecretsToVolume.subPath,
      secretName: configSecret.secret.metadata.name,
    });
  }

  if (!podConfig.ports) podConfig.ports = { http: 8080 };

  const deployment =
    deploymentConfig == false
      ? undefined
      : new kx.Deployment(
          name,
          {
            metadata: {
              namespace,
              annotations: { 'pulumi.com/skipAwait': 'true' },
              labels: { app: name, time: deploymentTime },
            },
            spec: buildPod({
              name,
              podConfig,
              envFrom,
              args: deploymentConfig?.args,
              useVirtualHost: deploymentConfig?.useVirtualHost,
            }).asDeploymentSpec({
              replicas: deploymentConfig?.replicas ?? 1,
              revisionHistoryLimit: 1,
              // strategy: {
              //   type: deploymentConfig?.strategy,
              //   rollingUpdate: undefined,
              // },
            }),
          },
          {
            provider,
            dependsOn,
            deleteBeforeReplace: true,
            replaceOnChanges: deploymentConfig?.enforceReDeployment
              ? ['*']
              : undefined,
            customTimeouts: { create: '1m', update: '1m' },
          }
        );

  let jobs: (kx.Job | k8s.batch.v1.CronJob)[] | undefined = undefined;
  //Jobs
  if (jobConfigs) {
    jobs = jobConfigs.map((job) => {
      if (!job.useVirtualHost && deploymentConfig !== false)
        job.useVirtualHost = Boolean(deploymentConfig?.useVirtualHost);

      if (job.cron)
        return new k8s.batch.v1.CronJob(
          job.name,
          {
            metadata: { namespace },
            spec: buildPod({
              name,
              podConfig,
              envFrom,
              useVirtualHost: job.useVirtualHost,
              args: job.args,
              restartPolicy: job.restartPolicy || 'Never',
            }).asCronJobSpec({
              failedJobsHistoryLimit: 1,
              successfulJobsHistoryLimit: 1,
              ...job.cron,
            }),
          },
          { provider, deleteBeforeReplace: true }
        );

      return new kx.Job(
        job.name,
        {
          metadata: {
            namespace,
            annotations: { 'pulumi.com/skipAwait': 'true' },
          },
          spec: buildPod({
            name,
            podConfig,
            envFrom,
            useVirtualHost: job.useVirtualHost,
            args: job.args,
            restartPolicy: job.restartPolicy || 'Never',
          }).asJobSpec({
            ttlSecondsAfterFinished: job.ttlSecondsAfterFinished || 604800, //7 days
          }),
        },
        { provider, deleteBeforeReplace: true }
      );
    });
  }

  let service: kx.Service | undefined = undefined;
  if (deployment && serviceConfig !== false) {
    // const servicePort: any = {
    //   name: 'http',
    //   port: 80,
    //   targetPort: podConfig.port,
    //   protocol: 'TCP',
    // };
    //
    // if (serviceConfig?.usePodPort) {
    //   servicePort.port = podConfig.port;
    //   //servicePort.targetPort = podConfig.port;
    // } else if (serviceConfig?.port) {
    //   servicePort.port = serviceConfig.port;
    //   //servicePort.targetPort = podConfig.port;
    // }

    const portKeys = Object.keys(podConfig.ports);
    //Service
    service = deployment.createService({
      name,
      ports:
        portKeys.length == 1
          ? [
              {
                name: 'http',
                port: serviceConfig?.usePodPort
                  ? podConfig.ports[portKeys[0]]
                  : 80,
                targetPort: podConfig.ports[portKeys[0]],
                protocol: 'TCP',
              },
            ]
          : portKeys.map((k) => ({
              name: k,
              port: podConfig.ports[k],
              //targetPort: podConfig.ports[k],
              protocol: 'TCP',
            })),
      type: serviceConfig?.useClusterIP ? 'LoadBalancer' : undefined,
    });
  }

  //Ingress
  if (ingressConfig && service) {
    const ingressProps = {
      ...ingressConfig,
      className: ingressConfig.className || 'nginx',

      name: `${name}-ingress`.toLowerCase(),
      hostNames: ingressConfig.hostNames.map((host) =>
        output(host).apply((h) => h.toLowerCase().replace('https://', ''))
      ),
      tlsSecretName: ingressConfig.allowHttp
        ? undefined
        : ingressConfig.tlsSecretName ||
          output(ingressConfig.hostNames).apply((h) =>
            getTlsName(
              ingressConfig.certManagerIssuer
                ? getDomainFromUrl(h[0])
                : getRootDomainFromUrl(h[0]),
              Boolean(ingressConfig.certManagerIssuer)
            )
          ),

      service,
      provider,
      dependsOn: [service],
    };

    if (ingressConfig.type === 'nginx') {
      NginxIngress(ingressProps);
    } else TraefikIngress(ingressProps);
  }

  if (enableHA && deployment) {
    PodAutoScale({ ...enableHA, deployment, provider });
  }

  return { deployment, service, jobs };
};
