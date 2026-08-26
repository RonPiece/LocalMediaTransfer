import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FileState, fileStatusPresentation } from '../transferPresentation';
import { mediaVariantLabel } from '@/services/upload/mediaVariants';

export const TransferFileItem = React.memo(function TransferFileItem({ item }: { item: FileState }) {
  const presentation = fileStatusPresentation(item.status);

  return (
    <View className="flex-row items-start justify-between py-3 border-b border-border">
      <View className="flex-row items-start flex-1">
        <Ionicons name={presentation.icon} size={20} color={presentation.color} />
        <View className="ml-3 flex-1">
          <Text className="text-on-surface text-sm" numberOfLines={1}>{item.filename}</Text>
          {item.mediaRole && item.mediaRole !== 'unknown' && (
            <Text className="text-on-surface-variant text-[11px] mt-0.5">
              {item.componentSemantics === 'optional' ? 'Additional' : 'Primary'} · {mediaVariantLabel(item.mediaRole)}
            </Text>
          )}
          {item.msg && <Text className="text-on-surface-variant text-xs mt-1 leading-4">{item.msg}</Text>}
        </View>
      </View>
      <Text style={{ color: presentation.color }} className="text-xs font-semibold ml-3">{presentation.text}</Text>
    </View>
  );
});
