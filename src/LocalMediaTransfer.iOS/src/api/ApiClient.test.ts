import { ApiClient } from './ApiClient';

describe('ApiClient dashboard contracts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('clears history with an authenticated DELETE request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'secret', 'production');

    await client.clearHistory();

    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.2:8080/transfer_history', expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ 'X-Upload-Token': 'secret' }),
    }));
  });

  it('requests authenticated cleanup for a cancelled iOS upload session', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'secret', 'production');

    await client.cancelUploadSession('ios-1700000000000');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.2:8080/upload_session/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Upload-Token': 'secret' }),
        body: JSON.stringify({ sessionId: 'ios-1700000000000' }),
      }),
    );
  });

  it('sends authenticated iPhone failure telemetry without throwing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'secret', 'production');

    await client.logClientEvent('ERROR', 'transfer_failed', 'Upload failed', { failedFiles: 4 });

    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.2:8080/client_log', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Upload-Token': 'secret' }),
    }));
  });

  it('reports a session-scoped decimal byte rate without making telemetry fatal', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const client = new ApiClient('http://192.168.1.2:8080', 'secret', 'production');

    await expect(client.reportClientSpeed('ios-session-1', 19_500_000)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.2:8080/client_metrics',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: 'ios-session-1', bytesPerSecond: 19_500_000 }),
      }),
    );
  });

  it('invalidates a saved connection when the server rejects its token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: jest.fn().mockResolvedValue('{"error":"Unauthorized"}'),
    } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'expired-token', 'production');
    const onUnauthorized = jest.fn();
    client.setAuthenticationFailureHandler(onUnauthorized);

    await expect(client.getHistory()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not treat pairing request denial as a saved-credential auth failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: jest.fn().mockResolvedValue({ status: 'denied', environment: 'production' }),
    } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'qr-token', 'production');
    const onUnauthorized = jest.fn();
    client.setAuthenticationFailureHandler(onUnauthorized);

    await expect(client.requestPairing('http://192.168.1.2:8080', 'device-id', 'iPhone', 'credential')).resolves.toBe('denied');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not treat pairing status denial as a saved-credential auth failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: jest.fn().mockResolvedValue({ status: 'denied', environment: 'production' }),
    } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'qr-token', 'production');
    const onUnauthorized = jest.fn();
    client.setAuthenticationFailureHandler(onUnauthorized);

    await expect(client.pairingStatus('http://192.168.1.2:8080', 'device-id', 'credential')).resolves.toBe('denied');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('can suppress unauthorized notifications during QR token validation', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ status: 'ok', version: '2.0.1', environment: 'production' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'qr-token', 'production');
    const onUnauthorized = jest.fn();
    client.setAuthenticationFailureHandler(onUnauthorized);

    await expect(client.pingServer({ notifyUnauthorized: false })).resolves.toBe(false);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not report connected when a replacement server rejects the saved token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ status: 'ok', version: '2.0.1', environment: 'production' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:8080', 'stale-token', 'production');
    const onUnauthorized = jest.fn();
    client.setAuthenticationFailureHandler(onUnauthorized);

    await expect(client.pingServer()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://192.168.1.2:8080/verify_token', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Upload-Token': 'stale-token' }),
    }));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('rejects a healthy server from the wrong environment before token verification', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ status: 'ok', version: '2.0.1', environment: 'test' }),
    } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:18080', 'token', 'production');

    await expect(client.pingServer()).resolves.toBe(false);
    expect(client.connectionError).toContain('expects the production desktop environment');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects legacy health responses that omit environment identity', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ status: 'ok', version: '2.0.1' }),
    } as unknown as Response);
    const client = new ApiClient('http://192.168.1.2:8080', '', 'production');

    await expect(client.pingServer()).resolves.toBe(false);
    expect(client.connectionError).toContain('does not report an environment identity');
  });
});
