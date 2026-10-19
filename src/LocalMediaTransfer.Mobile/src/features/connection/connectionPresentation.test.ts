import { createActiveConnection, receiverOrigin, receiverRowState } from './connectionPresentation';
import type { SavedConnection } from '@/app/types';

const saved: SavedConnection = { version: 3, environment: 'test', serverId: 'receiver',
  httpsUrl: 'https://receiver.local:443/', name: 'Saved name', certificateFingerprint: 'sample-only' };
const input = { address: 'https://RECEIVER.local/', isConnected: true, savedReceiver: saved, discoveredServers: [],
  security: { mode: 'https' as const, certificateVerified: false }, healthStatus: 'connected' as const };

it.each([
  ['https://RECEIVER.local:443/', 'https://receiver.local'],
  ['http://receiver.local:80/path?token=sample', 'http://receiver.local'],
  ['https://receiver.local:8443/path#fragment', 'https://receiver.local:8443'],
  ['https://[::1]:8443/', 'https://[::1]:8443'],
  ['ftp://receiver.local', null], ['invalid', null], ['https://user:sample@receiver.local', null],
])('normalizes public receiver origin %s', (address, expected) => {
  expect(receiverOrigin(address)).toBe(expected);
});

it('builds a credential-free model without treating saved trust as certificate verification', () => {
  const connection = createActiveConnection({ ...input, address: `${input.address}?token=sample` });
  expect(connection).toEqual({ address: 'https://receiver.local', name: 'Saved name', healthStatus: 'connected',
    security: { mode: 'https', certificateVerified: false }, trusted: true });
  expect(createActiveConnection({ ...input, isConnected: false })).toBeNull();
  expect(createActiveConnection({ ...input, address: 'invalid' })).toBeNull();
});

it('does not assign a different saved receiver by name and falls back to the actual hostname', () => {
  const connection = createActiveConnection({ ...input, address: 'https://other.local:8443' });
  expect(connection?.name).toBe('other.local');
  expect(connection?.trusted).toBe(false);
});

it('requires the same scheme and port, and blocks uncertain or busy actions', () => {
  const activeConnection = createActiveConnection(input);
  const state = { activeConnection, isConnected: true, isConnecting: false };
  expect(receiverRowState({ ...state, address: saved.httpsUrl })).toMatchObject({ connected: true, disabled: false });
  for (const address of ['http://receiver.local', 'https://receiver.local:8443', 'invalid']) {
    expect(receiverRowState({ ...state, address })).toMatchObject({ connected: false, disabled: true });
  }
  expect(receiverRowState({ ...state, activeConnection: null, address: saved.httpsUrl }).disabled).toBe(true);
  expect(receiverRowState({ ...state, isConnecting: true, address: saved.httpsUrl })).toMatchObject({ disabled: true, busy: true });
  expect(receiverRowState({ ...state, isConnected: false, address: saved.httpsUrl })).toMatchObject({ disabled: false, connected: false });
});
