import { getCertificateForDomain } from '@drunk-pulumi/azure/Web/Helpers';
import { convertPfxToPem } from '@drunk-pulumi/azure/Certificate';

export const getKubeDomainCert = async (domain: string) => {
  //Get cert from CertOrder.
  const cert = await getCertificateForDomain(domain);
  //Convert to K8s cert
  return cert
    ? convertPfxToPem({
        base64Cert: cert.base64CertData,
      })
    : undefined;
};
