import { awaitPairingApproval, activatePairingCredential } from './pairingHandshake';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const transport = () => ({ requestPairing: jest.fn(), pairingStatus: jest.fn(),
  setConfig: jest.fn(), pingServer: jest.fn() });

it('bounds pending approval to 24 polls and never activates it', async () => {
  const api = transport();
  api.requestPairing.mockResolvedValue('pending');
  api.pairingStatus.mockResolvedValue('pending');
  const pending = jest.fn();
  const result = awaitPairingApproval(api, 'https://example.invalid',
    { deviceId: 'synthetic', credential: 'synthetic' }, pending);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(await result).toBe('pending');
  expect(api.pairingStatus).toHaveBeenCalledTimes(24);
  expect(pending).toHaveBeenCalledTimes(1);
  expect(api.setConfig).not.toHaveBeenCalled();
});

it('stops polling as soon as receiver approval arrives', async () => {
  const api = transport();
  api.requestPairing.mockResolvedValue('pending');
  api.pairingStatus.mockResolvedValue('approved');
  const result = awaitPairingApproval(api, 'https://example.invalid',
    { deviceId: 'synthetic', credential: 'synthetic' }, jest.fn());
  await jest.advanceTimersByTimeAsync(2500);
  expect(await result).toBe('approved');
  expect(api.pairingStatus).toHaveBeenCalledTimes(1);
});

it('limits credential activation and returns failure instead of assuming approval authenticates', async () => {
  const api = transport();
  api.pingServer.mockResolvedValue(false);
  const result = activatePairingCredential(api, 'https://example.invalid', 'synthetic');
  await jest.advanceTimersByTimeAsync(1500);
  expect(await result).toBe(false);
  expect(api.pingServer).toHaveBeenCalledTimes(3);
  expect(api.pingServer).toHaveBeenCalledWith({ notifyUnauthorized: false });
});
