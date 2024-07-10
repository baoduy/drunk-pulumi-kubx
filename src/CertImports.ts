import { getKubeDomainCert } from "./Helpers";
import { getTlsName } from "./CertHelper";
import * as fs from "fs";
import { KeyVaultInfo } from "@drunk-pulumi/azure/types";
import { getSecret } from "@drunk-pulumi/azure/KeyVault/Helper";
import { K8sArgs } from "./types";
import ksCertSecret from "./Core/KsCertSecret";
import { convertPfxToPem } from "@drunk-pulumi/azure/Certificate";

export type FromCertOrderProps = K8sArgs & {
  namespaces: string[];
  /** The cert name or domain name */
  certName: string;
};

/** Import Cert to K8s from Azure Cert Order*/
export const certImportFromCertOrder = async ({
  namespaces,
  certName,
  ...others
}: FromCertOrderProps) => {
  const cert = await getKubeDomainCert(certName);
  if (!cert) return;

  const name = getTlsName(certName, false);
  namespaces.map((n, i) =>
    ksCertSecret({
      name: `${name}-${i}`,
      namespace: n,
      certInfo: cert,
      ...others,
    }),
  );
};

const getCertFromFolder = (folder: string) => {
  const cert = fs.readFileSync(`./${folder}/cert.crt`, { encoding: "utf8" });
  const ca = fs.readFileSync(`./${folder}/ca.crt`, { encoding: "utf8" });
  const privateKey = fs.readFileSync(`./${folder}/private.key`, {
    encoding: "utf8",
  });

  return { cert, ca, privateKey };
};

export type ImportCertFromFileProps = FromCertOrderProps & {
  certFolder: string;
};

export const certImportFromFolder = ({
  certName,
  namespaces,
  certFolder,
  ...others
}: ImportCertFromFileProps) => {
  const cert = getCertFromFolder(certFolder);
  if (!cert) return;

  const name = getTlsName(certName, false);
  namespaces.map((n, i) =>
    ksCertSecret({
      name: `${name}-${i}`,
      namespace: n,
      certInfo: cert,
      ...others,
    }),
  );

  return name;
};

export type ImportCertFromVaultProps = K8sArgs & {
  certNames: string[];
  namespace: string;
  vaultInfo: KeyVaultInfo;
};

export const certImportFromVault = async ({
  certNames,
  namespace,
  vaultInfo,
  ...others
}: ImportCertFromVaultProps) => {
  await Promise.all(
    certNames.map(async (c, i) => {
      const cert = await getSecret({
        name: c,
        nameFormatted: false,
        vaultInfo,
      });

      const pems = cert?.value
        ? convertPfxToPem({
            base64Cert: cert.value,
            password: "",
          })
        : undefined;

      if (pems) {
        ksCertSecret({
          name: `${c}-${i}`,
          namespace,
          certInfo: pems,
          ...others,
        });
      }
    }),
  );
};
