import {
  ClientServerEnvironment,
  expectedServerEnvironment,
  nativeCapabilities,
} from '@/services/NativeCapabilities';
import {
  ClientLogLevel,
  HealthResponse,
  PairingStatus,
  PreflightAction,
  PreflightFile,
  PreflightFileResult,
  PreflightResponse,
  PreflightVerifyFile,
  TransferHistoryItem,
  TransferHistoryPayload,
} from './types';

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export class ServerEnvironmentMismatchError extends Error {
  constructor(
    public readonly expected: ClientServerEnvironment,
    public readonly actual: string,
  ) {
    super(
      actual
        ? `This app expects the ${expected} desktop environment, but reached ${actual}. Open the matching Windows app and try again.`
        : `This desktop does not report an environment identity. Update Windows Local Media Transfer before connecting.`,
    );
    this.name = 'ServerEnvironmentMismatchError';
  }
}

type PingServerOptions = {
  notifyUnauthorized?: boolean;
};

export class ApiClient {
  private serverUrl: string | null = null;
  private token: string | null = null;
  private connectedServerVersion: string | null = null;
  private connectionFailureReason: string | null = null;
  private authenticationFailureHandler: (() => void) | null = null;

  constructor(
    serverUrl?: string,
    token?: string,
    private readonly expectedEnvironment: ClientServerEnvironment = expectedServerEnvironment(),
  ) {
    if (serverUrl) {
      this.serverUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    }
    if (token) {
      this.token = token;
    }
  }

  public setConfig(serverUrl: string, token: string) {
    this.serverUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    this.token = token;
  }

  public setAuthenticationFailureHandler(handler: (() => void) | null) {
    this.authenticationFailureHandler = handler;
  }

  public notifyUnauthorized() {
    this.authenticationFailureHandler?.();
  }

  private async requireOk(response: Response, operation: string): Promise<Response> {
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403) this.notifyUnauthorized();
    let detail = response.statusText;
    try {
      detail = (await response.text()) || detail;
    } catch {}
    throw new ApiRequestError(`${operation}: HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status);
  }

  private async readJson(response: Response): Promise<unknown> {
    return await response.json();
  }

  private parsePairingStatus(body: unknown): PairingStatus {
    if (typeof body === 'object' && body !== null && 'status' in body) {
      const status = (body as { status?: unknown }).status;
      if (status === 'approved' || status === 'pending' || status === 'denied') return status;
    }
    return 'denied';
  }

  private async readPairingStatus(response: Response, operation: string): Promise<PairingStatus> {
    try {
      const body = await this.readJson(response);
      this.requireExpectedEnvironment(body);
      return this.parsePairingStatus(body);
    } catch (error) {
      if (error instanceof ServerEnvironmentMismatchError) throw error;
      console.warn(`${operation}: failed to parse pairing response.`);
      return 'denied';
    }
  }

  private parseHealth(body: unknown): HealthResponse {
    if (typeof body !== 'object' || body === null) return {};
    const version = (body as { version?: unknown }).version;
    const environment = (body as { environment?: unknown }).environment;
    return {
      version: typeof version === 'string' ? version : undefined,
      environment: environment === 'production' || environment === 'test' || environment === 'benchmark'
        ? environment
        : undefined,
    };
  }

  private requireExpectedEnvironment(body: unknown): void {
    const environment = typeof body === 'object' && body !== null &&
      typeof (body as { environment?: unknown }).environment === 'string'
      ? (body as { environment: string }).environment
      : '';
    if (environment !== this.expectedEnvironment) {
      throw new ServerEnvironmentMismatchError(this.expectedEnvironment, environment);
    }
  }

  private parsePreflightAction(value: unknown): PreflightAction {
    if (value === 'skip' || value === 'hash_required') return value;
    return 'upload';
  }

  private parsePreflightResponse(body: unknown): PreflightResponse {
    if (typeof body !== 'object' || body === null) return { files: [] };
    const files = (body as { files?: unknown }).files;
    if (!Array.isArray(files)) return { files: [] };
    const parsedFiles: PreflightFileResult[] = [];
    for (const item of files) {
      if (typeof item !== 'object' || item === null) continue;
      const { id, action, filename, verification } = item as {
        id?: unknown;
        action?: unknown;
        filename?: unknown;
        verification?: unknown;
      };
      if (typeof id !== 'string' || id.length === 0) continue;
      parsedFiles.push({
        id,
        action: this.parsePreflightAction(action),
        ...(typeof filename === 'string' && filename ? { filename } : {}),
        ...(verification === 'inconclusive' ? { verification } : {}),
      });
    }
    return { files: parsedFiles };
  }

  private parseTransferHistory(body: unknown): TransferHistoryItem[] {
    if (!Array.isArray(body)) return [];
    return body
      .filter((item): item is TransferHistoryItem => typeof item === 'object' && item !== null)
      .map(item => ({
        sessionId: typeof item.sessionId === 'string' ? item.sessionId : undefined,
        completedAt: typeof item.completedAt === 'number' || typeof item.completedAt === 'string' ? item.completedAt : undefined,
        uploadedFiles: typeof item.uploadedFiles === 'number' ? item.uploadedFiles : undefined,
        skippedFiles: typeof item.skippedFiles === 'number' ? item.skippedFiles : undefined,
        failedFiles: typeof item.failedFiles === 'number' ? item.failedFiles : undefined,
        averageSpeedMBps: typeof item.averageSpeedMBps === 'number' ? item.averageSpeedMBps : undefined,
        peakSpeedMBps: typeof item.peakSpeedMBps === 'number' ? item.peakSpeedMBps : undefined,
        selectedAssets: typeof item.selectedAssets === 'number' ? item.selectedAssets : undefined,
        expandedFiles: typeof item.expandedFiles === 'number' ? item.expandedFiles : undefined,
        selectedBytes: typeof item.selectedBytes === 'number' ? item.selectedBytes : undefined,
        selectedMediaBytes: typeof item.selectedMediaBytes === 'number'
          ? item.selectedMediaBytes
          : undefined,
        additionalComponentsBytes: typeof item.additionalComponentsBytes === 'number'
          ? item.additionalComponentsBytes
          : undefined,
        selectedMediaFiles: typeof item.selectedMediaFiles === 'number'
          ? item.selectedMediaFiles
          : undefined,
        additionalComponentsFiles: typeof item.additionalComponentsFiles === 'number'
          ? item.additionalComponentsFiles
          : undefined,
        uploadedBytes: typeof item.uploadedBytes === 'number' ? item.uploadedBytes : undefined,
        skippedBytes: typeof item.skippedBytes === 'number' ? item.skippedBytes : undefined,
        avoidedBytes: typeof item.avoidedBytes === 'number' ? item.avoidedBytes : undefined,
        finalizationDuplicateBytes: typeof item.finalizationDuplicateBytes === 'number'
          ? item.finalizationDuplicateBytes
          : undefined,
        files: Array.isArray(item.files)
          ? item.files.filter(file => typeof file === 'object' && file !== null) as TransferHistoryItem['files']
          : undefined,
      }));
  }

  public get url(): string {
    return this.serverUrl || '';
  }

  public get uploadToken(): string {
    return this.token || '';
  }

  public get serverVersion(): string {
    return this.connectedServerVersion || '';
  }

  public get connectionError(): string {
    return this.connectionFailureReason || '';
  }

  private get headers(): HeadersInit {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.token) {
      h['X-Upload-Token'] = this.token;
    }
    return h;
  }

  private async transportFetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (url.toLowerCase().startsWith('https://')) {
      if (!nativeCapabilities.available) {
        throw new Error('Pinned HTTPS requires the installed iOS app');
      }
      const headerRecord: Record<string, string> = {};
      new Headers(init.headers || {}).forEach((value, name) => { headerRecord[name] = value; });
      const result = await nativeCapabilities.request({
        url,
        method: init.method || 'GET',
        headers: headerRecord,
        body: typeof init.body === 'string' ? init.body : undefined,
      });
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        statusText: '',
        text: async () => result.body,
        json: async () => result.body ? JSON.parse(result.body) : null,
      } as Response;
    }
    return globalThis.fetch(url, init);
  }

  public async pingServer(options: PingServerOptions = {}): Promise<boolean> {
    if (!this.serverUrl) return false;
    this.connectionFailureReason = null;
    const notifyUnauthorized = options.notifyUnauthorized !== false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.transportFetch(`${this.serverUrl}/_health`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });
      
      if ((response.status === 401 || response.status === 403) && notifyUnauthorized) this.notifyUnauthorized();
      if (response.ok) {
        const health = this.parseHealth(await this.readJson(response));
        this.requireExpectedEnvironment(health);
        this.connectedServerVersion = health.version || null;
        if (this.token) {
          const verifyResponse = await this.transportFetch(`${this.serverUrl}/verify_token`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ token: this.token }),
            signal: controller.signal,
          });
          if (!verifyResponse.ok) {
            if ((verifyResponse.status === 401 || verifyResponse.status === 403) && notifyUnauthorized) {
              this.notifyUnauthorized();
            }
            clearTimeout(timeoutId);
            return false;
          }
          this.requireExpectedEnvironment(await this.readJson(verifyResponse));
        }
      }
      clearTimeout(timeoutId);
      return response.ok;
    } catch (err) {
      clearTimeout(timeoutId);
      this.connectionFailureReason = err instanceof Error ? err.message : 'Connection failed.';
      console.warn('Ping failed.');
      return false;
    }
  }

  public async requestPairing(serverUrl: string, deviceId: string, deviceName: string, credential: string): Promise<PairingStatus> {
    const response = await this.transportFetch(`${serverUrl}/pair/request`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ deviceId, deviceName, credential }),
    });
    return this.readPairingStatus(response, 'Pairing request failed');
  }

  public async pairingStatus(serverUrl: string, deviceId: string, credential: string): Promise<PairingStatus> {
    const response = await this.transportFetch(`${serverUrl}/pair/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ deviceId, credential }),
    });
    return this.readPairingStatus(response, 'Pairing status failed');
  }

  public async preflightCheck(files: PreflightFile[]): Promise<PreflightResponse> {
    if (!this.serverUrl) throw new Error("Server URL not configured");
    
    const response = await this.transportFetch(`${this.serverUrl}/upload/preflight`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ files }),
    });

    return this.parsePreflightResponse(await this.readJson(await this.requireOk(response, 'Preflight failed')));
  }

  public async preflightVerify(files: PreflightVerifyFile[]): Promise<PreflightResponse> {
    if (!this.serverUrl) throw new Error('Server URL not configured');
    const response = await this.transportFetch(`${this.serverUrl}/upload/preflight/verify`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ files }),
    });
    return this.parsePreflightResponse(await this.readJson(await this.requireOk(response, 'Duplicate verification failed')));
  }

  public async logClientEvent(
    level: ClientLogLevel,
    event: string,
    message: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.serverUrl) return;
    try {
      await this.transportFetch(`${this.serverUrl}/client_log`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          session: data.sessionId || 'ios',
          level,
          event,
          message,
          data,
          ts: new Date().toISOString(),
          client: 'expo-ios',
        }),
      });
    } catch {
      // Telemetry must never become the reason an upload fails.
    }
  }

  public async reportClientSpeed(sessionId: string, bytesPerSecond: number): Promise<void> {
    if (!this.serverUrl) return;
    try {
      await this.transportFetch(`${this.serverUrl}/client_metrics`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ sessionId, bytesPerSecond }),
      });
    } catch {
      // Live metrics are observability only and must never fail a transfer.
    }
  }

  public async transferHistory(payload: TransferHistoryPayload): Promise<void> {
    if (!this.serverUrl) throw new Error("Server URL not configured");
    
    const response = await this.transportFetch(`${this.serverUrl}/transfer_history`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    await this.requireOk(response, 'Transfer history failed');
  }

  public async getHistory(): Promise<TransferHistoryItem[]> {
    if (!this.serverUrl) throw new Error("Server URL not configured");
    const response = await this.transportFetch(`${this.serverUrl}/transfer_history/recent`, {
      method: 'GET',
      headers: this.headers,
    });
    return this.parseTransferHistory(await this.readJson(await this.requireOk(response, 'Failed to fetch history')));
  }

  public async clearHistory(): Promise<void> {
    if (!this.serverUrl) throw new Error("Server URL not configured");
    const response = await this.transportFetch(`${this.serverUrl}/transfer_history`, {
      method: 'DELETE',
      headers: this.headers,
    });
    await this.requireOk(response, 'Failed to delete history');
  }

  public async cancelUploadSession(sessionId: string): Promise<void> {
    if (!this.serverUrl) return;
    const response = await this.transportFetch(`${this.serverUrl}/upload_session/cancel`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ sessionId }),
    });
    await this.requireOk(response, 'Failed to clean up cancelled upload session');
  }
}

export const api = new ApiClient();
