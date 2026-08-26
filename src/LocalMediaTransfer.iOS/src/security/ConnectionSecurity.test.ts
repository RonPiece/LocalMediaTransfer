import {
  UnsupportedPairingPayloadVersionError,
  normalizeFingerprint,
  parseLegacyConnectionUrl,
  parsePairingPayload,
} from './ConnectionSecurity';

describe('pinned HTTPS pairing payload', () => {
  it('accepts a complete version 3 payload and normalizes its fingerprint', () => {
    const payload = parsePairingPayload(JSON.stringify({
      type: 'lmt-pair',
      version: 3,
      environment: 'production',
      serverId: 'desktop-1',
      name: 'Desktop',
      httpsUrl: 'https://192.168.1.2:8443',
      certificateFingerprint: 'AB:CD'.replace('AB:CD', 'ab'.repeat(32)),
      token: 'qr-token',
      httpUrl: 'http://192.168.1.2:8080',
    }));
    expect(payload?.certificateFingerprint).toBe('ab'.repeat(32));
  });

  it('rejects missing trust data and malformed fingerprints', () => {
    expect(parsePairingPayload('{"type":"lmt-pair","version":3}')).toBeNull();
    expect(normalizeFingerprint('AA:bb-01')).toBe('aabb01');
  });

  it('rejects unsafe, incomplete, or environment-free version 3 payloads', () => {
    expect(parsePairingPayload(JSON.stringify({
      type: 'lmt-pair',
      version: 3,
      environment: 'production',
      serverId: 'desktop-1',
      httpsUrl: 'http://192.168.1.2:8080',
      certificateFingerprint: 'ab'.repeat(32),
      token: 'qr-token',
    }))).toBeNull();

    expect(parsePairingPayload(JSON.stringify({
      type: 'lmt-pair',
      version: 3,
      environment: 'production',
      serverId: 'desktop-1',
      httpsUrl: 'https://192.168.1.2:8443',
      certificateFingerprint: 'ab'.repeat(32),
      token: 'qr-token',
      httpUrl: 'https://192.168.1.2:8443',
    }))).toBeNull();

    expect(parsePairingPayload(JSON.stringify({
      type: 'lmt-pair',
      version: 3,
      serverId: 'desktop-1',
      httpsUrl: 'https://192.168.1.2:8443',
      certificateFingerprint: 'ab'.repeat(32),
      token: 'qr-token',
    }))).toBeNull();
  });

  it('throws a specific error for unsupported pairing payload versions', () => {
    expect(() => parsePairingPayload(JSON.stringify({
      type: 'lmt-pair',
      version: 4,
      environment: 'production',
      serverId: 'desktop-1',
      httpsUrl: 'https://192.168.1.2:8443',
      certificateFingerprint: 'ab'.repeat(32),
      token: 'qr-token',
    }))).toThrow(UnsupportedPairingPayloadVersionError);
  });

  it('logs malformed JSON pairing payloads without logging legacy URL scans', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(parsePairingPayload('{"type":"lmt-pair","version":3')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to parse Local Media Transfer pairing QR payload.',
    );

    errorSpy.mockClear();
    expect(parsePairingPayload('http://192.168.1.2:8080/?token=abc')).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('parses legacy browser URLs without accepting non-HTTP schemes', () => {
    expect(parseLegacyConnectionUrl('http://192.168.1.2:8080/?token=abc')).toEqual({
      baseUrl: 'http://192.168.1.2:8080',
      token: 'abc',
    });
    expect(parseLegacyConnectionUrl('http://192.168.1.2:8080/?token=abc?def&mode=legacy')).toEqual({
      baseUrl: 'http://192.168.1.2:8080',
      token: 'abc?def',
    });
    expect(parseLegacyConnectionUrl('http://192.168.1.2:8080/')).toBeNull();
    expect(parseLegacyConnectionUrl('file:///tmp/test?token=abc')).toBeNull();
  });
});
