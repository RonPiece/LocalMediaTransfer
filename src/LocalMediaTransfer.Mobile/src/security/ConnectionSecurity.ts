export interface PairingPayload {
  type: 'lmt-pair';
  version: 3;
  environment: 'production' | 'test';
  serverId: string;
  name: string;
  httpsUrl: string;
  certificateFingerprint: string;
  token: string;
  httpUrl?: string;
}

export class UnsupportedPairingPayloadVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported pairing payload version ${version}`);
    this.name = 'UnsupportedPairingPayloadVersionError';
  }
}

export const normalizeFingerprint = (value: string): string =>
  value.toLowerCase().replace(/[^0-9a-f]/g, '');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function parsePairingPayload(value: string): PairingPayload | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObject(parsed)) return null;

    if (parsed.type !== 'lmt-pair') return null;

    if (typeof parsed.version === 'number' && parsed.version !== 3) {
      throw new UnsupportedPairingPayloadVersionError(parsed.version);
    }

    const fingerprint = normalizeFingerprint(optionalString(parsed.certificateFingerprint) || '');
    const serverId = optionalString(parsed.serverId);
    const name = optionalString(parsed.name) || 'Desktop';
    const httpsUrl = optionalString(parsed.httpsUrl);
    const token = optionalString(parsed.token);
    const httpUrl = optionalString(parsed.httpUrl);
    const environment = parsed.environment === 'production' || parsed.environment === 'test'
      ? parsed.environment
      : undefined;

    if (
      parsed.version !== 3 ||
      !environment ||
      !serverId ||
      !httpsUrl?.startsWith('https://') ||
      !token ||
      fingerprint.length !== 64 ||
      (httpUrl !== undefined && !httpUrl.startsWith('http://'))
    ) {
      return null;
    }

    return {
      type: 'lmt-pair',
      version: 3,
      environment,
      serverId,
      name,
      httpsUrl,
      certificateFingerprint: fingerprint,
      token,
      httpUrl,
    };
  } catch (error) {
    if (error instanceof UnsupportedPairingPayloadVersionError) {
      throw error;
    }
    if (looksLikeJson(value)) {
      console.error('Failed to parse Local Media Transfer pairing QR payload.');
    }
    return null;
  }
}

export type LegacyConnectionUrl = {
  baseUrl: string;
  token: string;
};

export function parseLegacyConnectionUrl(value: string): LegacyConnectionUrl | null {
  if (!value.startsWith('http://') && !value.startsWith('https://')) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const token = parsed.searchParams.get('token') || '';
    if (!token) return null;
    parsed.search = '';
    parsed.hash = '';
    const baseUrl = parsed.toString().replace(/\/$/, '');
    return {
      baseUrl,
      token,
    };
  } catch {
    return null;
  }
}
