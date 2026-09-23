import React from 'react';
import { Alert } from 'react-native';

import { api } from '@/api/ApiClient';
import { TransferHistoryItem } from '@/api/types';
import { normalizeHistoryItems } from '@/features/dashboard/hooks/useDashboardHistory';

export function useReceiverHistory({ isConnected }: { isConnected: boolean }) {
  const [items, setItems] = React.useState<TransferHistoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestId = React.useRef(0);

  const refresh = React.useCallback(async () => {
    if (!isConnected) {
      requestId.current += 1;
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    const activeRequest = requestId.current + 1;
    requestId.current = activeRequest;
    setLoading(true);
    setError(null);
    try {
      const history = normalizeHistoryItems(await api.getHistory());
      if (requestId.current === activeRequest) setItems(history);
    } catch (reason) {
      if (requestId.current !== activeRequest) return;
      setError(reason instanceof Error ? reason.message : 'Transfer history could not be loaded.');
    } finally {
      if (requestId.current === activeRequest) setLoading(false);
    }
  }, [isConnected]);

  React.useEffect(() => {
    if (!isConnected) {
      requestId.current += 1;
      // Disconnecting invalidates receiver-hosted data immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      setError(null);
      setLoading(false);
    }
  }, [isConnected]);

  const confirmClear = React.useCallback(() => {
    Alert.alert(
      'Delete receiver history?',
      'This permanently deletes the saved transfer history from the connected receiver.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.clearHistory();
              setItems([]);
            } catch (reason) {
              Alert.alert('Could not delete history', reason instanceof Error ? reason.message : 'Try again while connected.');
            }
          },
        },
      ],
    );
  }, []);

  return { items, loading, error, refresh, confirmClear };
}
