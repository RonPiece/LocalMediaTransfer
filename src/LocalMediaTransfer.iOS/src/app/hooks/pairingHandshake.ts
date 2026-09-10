import type { api } from '@/api/ApiClient';

type PairingTransport = Pick<typeof api, 'requestPairing' | 'pairingStatus' | 'pingServer' | 'setConfig'>;
type DeviceIdentity = { deviceId: string; credential: string };

/** Bounded receiver approval polling; UI and trust persistence remain caller-owned. */
export async function awaitPairingApproval(
  transport: PairingTransport,
  url: string,
  identity: DeviceIdentity,
  onPending: () => void,
) {
  let status = await transport.requestPairing(url, identity.deviceId, 'iPhone', identity.credential);
  if (status === 'pending') {
    onPending();
    for (let attempt = 0; attempt < 24 && status === 'pending'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      status = await transport.pairingStatus(url, identity.deviceId, identity.credential);
    }
  }
  return status;
}

/** Approval is not authentication: validate the activated credential before saving trust. */
export async function activatePairingCredential(
  transport: PairingTransport, url: string, credential: string,
): Promise<boolean> {
  transport.setConfig(url, credential);
  let activated = false;
  for (let attempt = 0; attempt < 3 && !activated; attempt += 1) {
    activated = await transport.pingServer({ notifyUnauthorized: false });
    if (!activated) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return activated;
}
