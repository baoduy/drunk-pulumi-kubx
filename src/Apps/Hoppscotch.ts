import { DefaultK8sArgs } from "../types";
import { randomPassword } from "@drunk-pulumi/azure/Core/Random";
import * as k8s from "@pulumi/kubernetes";
import { Input, interpolate } from "@pulumi/pulumi";
import IdentityCreator from "@drunk-pulumi/azure/AzAd/Identity";
import { KeyVaultInfo } from "@drunk-pulumi/azure/types";
import Namespace from "../Core/Namespace";

interface HoppscotchProps extends Omit<DefaultK8sArgs, "namespace"> {
  namespace?: string;
  appHost: string;
  adminHost: string;
  backendHost: string;
  enableIngress?: boolean;

  postgres: {
    host: Input<string>;
    port: Input<number>;
    database: Input<string>;
    username: Input<string>;
    password: Input<string>;
    sslmode?: boolean;
  };
  vaultInfo?: KeyVaultInfo;
}

export default ({
  name = "hoppscotch",
  namespace = "hoppscotch",

  appHost,
  adminHost,
  backendHost,
  enableIngress,

  postgres,
  provider,
  vaultInfo,
}: HoppscotchProps) => {
  const callBackUrl = `https://${backendHost}/v1/auth/microsoft/callback`;

  // const password = auth?.rootPass
  //     ? auth.rootPass
  //     : randomPassword({
  //         name,
  //         length: 25,
  //         options: { special: false },
  //         policy: false,
  //         vaultInfo,
  //     }).result;

  const identity = IdentityCreator({
    name,
    appRoleAssignmentRequired: false,
    createPrincipal: false,
    createClientSecret: true,
    appType: "web",
    replyUrls: [callBackUrl],
    vaultInfo,

    optionalClaims: {
      idTokens: [{ name: "groups", essential: false }],
      accessTokens: [{ name: "groups", essential: false }],
    },
  });

  const ns = Namespace({ name: namespace, provider });

  const hoppscotch = new k8s.helm.v3.Chart(
    name,
    {
      namespace,
      chart: "hoppscotch",
      fetchOpts: { repo: "https://wdaan.github.io/hoppscotch-helm" },

      values: {
        global: {
          env: {
            DATABASE_URL: interpolate`postgresql://${postgres.username}:${postgres.password}@${postgres.host}:${postgres.port}/${postgres.database}${postgres.sslmode ? "?sslmode=require" : ""}`,
            // Auth Tokens Config
            JWT_SECRET: randomPassword({
              name: `${name}-jtw`,
              policy: "yearly",
              length: 25,
            }).result,
            TOKEN_SALT_COMPLEXITY: 10,
            MAGIC_LINK_TOKEN_VALIDITY: 3,
            REFRESH_TOKEN_VALIDITY: "604800000", // Default validity is 7 days (604800000 ms) in ms
            ACCESS_TOKEN_VALIDITY: "86400000", // Default validity is 1 day (86400000 ms) in ms
            SESSION_SECRET: randomPassword({
              name: `${name}-session`,
              policy: "yearly",
              length: 25,
            }).result,

            // Hoppscotch App Domain Config
            REDIRECT_URL: `https://${appHost}`,
            WHITELISTED_ORIGINS: `https://${appHost},https://${adminHost},https://${backendHost}`,

            // Microsoft Auth Config
            MICROSOFT_CLIENT_ID: identity.clientId,
            MICROSOFT_CLIENT_SECRET: identity.clientSecret,
            MICROSOFT_CALLBACK_URL: callBackUrl,
            MICROSOFT_SCOPE: "user.read",

            // Rate Limit Config
            RATE_LIMIT_TTL: 60, // In seconds
            RATE_LIMIT_MAX: 100, // Max requests per IP
          },
        },
      },
    },
    { provider, dependsOn: ns },
  );

  return hoppscotch;
};
