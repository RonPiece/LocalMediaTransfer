import { AlertButton } from 'react-native';

export type MainTab = 'home' | 'transfers' | 'connect' | 'history' | 'settings';
export type ScreenState = MainTab | 'picker' | 'transfer';
export type ConnectionHealthStatus = 'idle' | 'checking' | 'connected' | 'retrying' | 'disconnected';

export type ConnectionSecurityState = {
  mode: 'disconnected' | 'https' | 'http';
  tlsVersion?: string;
  certificateVerified: boolean;
};

export type SavedConnection = {
  version: 3;
  environment: 'production' | 'test';
  serverId: string;
  httpsUrl: string;
  httpUrl?: string;
  certificateFingerprint: string;
  name?: string;
};

export type ConfirmStyle = AlertButton['style'];
