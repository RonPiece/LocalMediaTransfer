import { ConnectionHealthStatus, ConnectionSecurityState } from '@/app/types';
import { TransferHistoryItem } from '@/api/types';
import { PreparationMode } from '@/services/upload/types';

export type DashboardScreenProps = {
  isConnected: boolean;
  connectionSecurity?: ConnectionSecurityState;
  connectionHealthStatus?: ConnectionHealthStatus;
  allowInsecureHttp?: boolean;
  nativeHttpsAvailable?: boolean;
  onAllowInsecureHttpChange?: (enabled: boolean) => void;
  onExplainUnencryptedHttp?: () => void;
  onTransferMedia: () => void;
  onDisconnect: () => void;
  onRetryConnection?: () => void;
  nearbyDiscoveryEnabled?: boolean;
  onNearbyDiscoveryChange?: (enabled: boolean) => void;
  preparationMode?: PreparationMode;
  onPreparationModeChange?: (mode: PreparationMode) => void;
  skipExactDuplicates?: boolean;
  onSkipExactDuplicatesChange?: (enabled: boolean) => void;
  includeAdditionalMediaComponents?: boolean;
  onIncludeAdditionalMediaComponentsChange?: (enabled: boolean) => void;
};

export type DashboardSettings = {
  skipDuplicates: boolean;
  includeAdditionalMediaComponents: boolean;
};

export type HistoryItem = TransferHistoryItem & {
  clientHistoryId?: string;
};
