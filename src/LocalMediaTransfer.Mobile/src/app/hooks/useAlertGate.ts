import React from 'react';
import { Alert } from 'react-native';
import { ConfirmStyle } from '../types';

export function useAlertGate() {
  const alertVisibleRef = React.useRef(false);

  const showAlertOnce = React.useCallback((title: string, message?: string, buttons?: Parameters<typeof Alert.alert>[2]) => {
    if (alertVisibleRef.current) return;
    alertVisibleRef.current = true;
    const wrappedButtons = (buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }]).map(button => ({
      ...button,
      onPress: () => {
        alertVisibleRef.current = false;
        button.onPress?.();
      },
    }));
    Alert.alert(title, message, wrappedButtons, {
      onDismiss: () => {
        alertVisibleRef.current = false;
      },
    });
  }, []);

  const confirmOnce = React.useCallback((title: string, message: string, confirmText: string, confirmStyle: ConfirmStyle = 'default') => new Promise<boolean>(resolve => {
    if (alertVisibleRef.current) {
      resolve(false);
      return;
    }
    alertVisibleRef.current = true;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      alertVisibleRef.current = false;
      resolve(value);
    };
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => finish(false) },
      { text: confirmText, style: confirmStyle, onPress: () => finish(true) },
    ], {
      onDismiss: () => finish(false),
    });
  }), []);

  return { showAlertOnce, confirmOnce };
}
