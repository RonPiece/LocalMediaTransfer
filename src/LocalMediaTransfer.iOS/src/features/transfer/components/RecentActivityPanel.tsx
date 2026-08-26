import React from 'react';
import { FlatList, ListRenderItemInfo, Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/theme';
import { FileState } from '../transferPresentation';
import { TransferFileItem } from './TransferFileItem';

const previewContentStyle = { paddingHorizontal: 16 };
const expandedContentStyle = { paddingHorizontal: 20, paddingBottom: 24 };
const renderItem = ({ item }: ListRenderItemInfo<FileState>) => <TransferFileItem item={item} />;

export const RecentActivityPanel = React.memo(function RecentActivityPanel({
  items,
  compact,
}: {
  items: FileState[];
  compact: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const label = `Recent activity, ${items.length.toLocaleString()} recent items`;

  return (
    <>
      <View
        className={`flex-1 bg-surface rounded-2xl border border-border overflow-hidden ${compact ? 'min-h-[72px] max-h-[104px]' : 'min-h-[96px] max-h-[138px]'}`}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${label}. Open full list`}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(true)}
          className="bg-surface px-4 py-2.5 border-b border-border flex-row items-center justify-between"
        >
          <View className="flex-row items-center flex-1">
            <Text className="text-on-surface-variant text-xs font-bold uppercase tracking-wider">
              Recent activity
            </Text>
            {items.length > 0 && (
              <View className="ml-2 px-2 py-0.5 rounded-full bg-background">
                <Text className="text-on-surface-variant text-[11px] font-semibold">
                  {items.length.toLocaleString()}
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center">
            <Text className="text-primary text-[12px] font-semibold mr-1">Expand</Text>
            <Ionicons name="chevron-up" size={17} color={theme.colors.primary} />
          </View>
        </TouchableOpacity>
        {items.length === 0 ? (
          <View className="flex-1 items-center justify-center px-4">
            <Text className="text-on-surface-variant text-[13px]">File activity will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={items.slice(0, compact ? 1 : 2)}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            scrollEnabled={false}
            contentContainerStyle={previewContentStyle}
          />
        )}
      </View>

      <Modal
        visible={expanded}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setExpanded(false)}
      >
        <SafeAreaView
          className="flex-1 bg-background"
          accessibilityViewIsModal
        >
          <View className="h-16 px-5 flex-row items-center justify-between border-b border-border bg-surface">
            <View>
              <Text accessibilityRole="header" className="text-on-surface text-lg font-bold">
                Recent activity
              </Text>
              <Text className="text-on-surface-variant text-xs">
                {items.length.toLocaleString()} most recent items
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Collapse recent activity"
              onPress={() => setExpanded(false)}
              className="h-10 px-4 rounded-full bg-background items-center justify-center flex-row"
            >
              <Ionicons name="chevron-down" size={17} color={theme.colors.primary} />
              <Text className="text-primary font-semibold ml-1">Collapse</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={items}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            initialNumToRender={16}
            maxToRenderPerBatch={16}
            windowSize={7}
            contentContainerStyle={expandedContentStyle}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
});
