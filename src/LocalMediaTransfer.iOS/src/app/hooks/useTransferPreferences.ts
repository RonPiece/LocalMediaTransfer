import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { connectionStorageKeys } from '@/config/storageKeys';
import { PreparationMode } from '@/services/upload/types';

const DEFAULT_PREPARATION_MODE: PreparationMode = 'prepare-first';
const ignorePersistenceError = () => undefined;

export function useTransferPreferences({
  onPersistenceError = ignorePersistenceError,
}: {
  onPersistenceError?: () => void;
} = {}) {
  const [preparationMode, setPreparationMode] = React.useState<PreparationMode>(
    DEFAULT_PREPARATION_MODE,
  );
  const [skipExactDuplicates, setSkipExactDuplicates] = React.useState(true);
  const [includeAdditionalMediaComponents, setIncludeAdditionalMediaComponents] = React.useState(false);
  const preparationRevision = React.useRef(0);
  const duplicateRevision = React.useRef(0);
  const additionalComponentsRevision = React.useRef(0);
  const preparationWriteChain = React.useRef(Promise.resolve());
  const duplicateWriteChain = React.useRef(Promise.resolve());
  const additionalComponentsWriteChain = React.useRef(Promise.resolve());

  React.useEffect(() => {
    let active = true;
    const preparationRevisionAtLoadStart = preparationRevision.current;
    const duplicateRevisionAtLoadStart = duplicateRevision.current;
    const additionalComponentsRevisionAtLoadStart = additionalComponentsRevision.current;
    void AsyncStorage.getItem(connectionStorageKeys.preparationMode())
      .then(value => {
        if (
          active &&
          preparationRevision.current === preparationRevisionAtLoadStart &&
          (value === 'streaming' || value === 'prepare-first')
        ) {
          setPreparationMode(value);
        }
      })
      .catch(() => onPersistenceError());
    void AsyncStorage.getItem(connectionStorageKeys.includeAdditionalMediaComponents())
      .then(value => {
        if (
          active &&
          additionalComponentsRevision.current === additionalComponentsRevisionAtLoadStart
        ) {
          if (value === 'true') setIncludeAdditionalMediaComponents(true);
          if (value === 'false') setIncludeAdditionalMediaComponents(false);
        }
      })
      .catch(() => onPersistenceError());
    void AsyncStorage.getItem(connectionStorageKeys.skipExactDuplicates())
      .then(value => {
        if (active && duplicateRevision.current === duplicateRevisionAtLoadStart) {
          if (value === 'false') setSkipExactDuplicates(false);
          if (value === 'true') setSkipExactDuplicates(true);
        }
      })
      .catch(() => onPersistenceError());
    return () => {
      active = false;
    };
  }, [onPersistenceError]);

  const persistPreparationMode = React.useCallback((mode: PreparationMode) => {
    preparationRevision.current += 1;
    setPreparationMode(mode);
    preparationWriteChain.current = preparationWriteChain.current
      .catch(() => undefined)
      .then(() => AsyncStorage.setItem(connectionStorageKeys.preparationMode(), mode))
      .catch(() => onPersistenceError());
  }, [onPersistenceError]);

  const persistSkipExactDuplicates = React.useCallback((enabled: boolean) => {
    duplicateRevision.current += 1;
    setSkipExactDuplicates(enabled);
    duplicateWriteChain.current = duplicateWriteChain.current
      .catch(() => undefined)
      .then(() => AsyncStorage.setItem(
        connectionStorageKeys.skipExactDuplicates(),
        enabled ? 'true' : 'false',
      ))
      .catch(() => onPersistenceError());
  }, [onPersistenceError]);

  const persistIncludeAdditionalMediaComponents = React.useCallback((enabled: boolean) => {
    additionalComponentsRevision.current += 1;
    setIncludeAdditionalMediaComponents(enabled);
    additionalComponentsWriteChain.current = additionalComponentsWriteChain.current
      .catch(() => undefined)
      .then(() => AsyncStorage.setItem(
        connectionStorageKeys.includeAdditionalMediaComponents(),
        enabled ? 'true' : 'false',
      ))
      .catch(() => onPersistenceError());
  }, [onPersistenceError]);

  return {
    preparationMode,
    persistPreparationMode,
    skipExactDuplicates,
    persistSkipExactDuplicates,
    includeAdditionalMediaComponents,
    persistIncludeAdditionalMediaComponents,
  };
}
