import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RevealMismatchItem } from '@/lib/database.types';
import { CURIOSITY_BRIDGE_SCRIPTS } from '@/lib/reveal';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export type MismatchBridgeItem = RevealMismatchItem & {
  category?: string;
};

export interface MismatchBridgeModalProps {
  visible: boolean;
  item?: MismatchBridgeItem | null;
  items?: MismatchBridgeItem[];
  onClose: () => void;
  onParkForNow?: (item: MismatchBridgeItem | null) => void;
  onTalkAboutIt?: (item: MismatchBridgeItem | null) => void;
  onDiscussInJournal?: (item: MismatchBridgeItem | null) => void;
}

/**
 * Non-judgmental Curiosity Bridge modal (`components/MismatchBridgeModal.tsx`).
 * Surfaces items where one partner rated 4–5 and the other rated 3 ("open to
 * exploring"), with zero directional attribution and zero numeric scores,
 * paired with three therapist-vetted conversation scripts.
 */
export function MismatchBridgeModal({
  visible,
  item,
  items = [],
  onClose,
  onParkForNow,
  onTalkAboutIt,
  onDiscussInJournal,
}: MismatchBridgeModalProps) {
  const colors = useThemeColors();
  const [selectedId, setSelectedId] = useState<string | null>(
    item?.library_item_id ?? items[0]?.library_item_id ?? null,
  );
  const [selectedScriptId, setSelectedScriptId] = useState<string>(
    CURIOSITY_BRIDGE_SCRIPTS[0]?.id ?? 'curiosity-check-in',
  );

  useEffect(() => {
    if (visible) {
      setSelectedId(
        item?.library_item_id ?? items[0]?.library_item_id ?? null,
      );
      setSelectedScriptId(
        CURIOSITY_BRIDGE_SCRIPTS[0]?.id ?? 'curiosity-check-in',
      );
    }
  }, [item?.library_item_id, items, visible]);

  const pool: MismatchBridgeItem[] =
    items.length > 0 ? items : item ? [item] : [];
  const activeItem: MismatchBridgeItem | null =
    pool.find((candidate) => candidate.library_item_id === selectedId) ??
    item ??
    pool[0] ??
    null;

  function handleTalkAboutIt() {
    onTalkAboutIt?.(activeItem);
    onClose();
  }

  function handleParkForNow() {
    onParkForNow?.(activeItem);
    onClose();
  }

  function handleDiscussInJournal() {
    if (onDiscussInJournal) {
      onDiscussInJournal(activeItem);
      onClose();
      return;
    }
    onClose();
    router.push('/(app)/journal' as Href);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close Curiosity Bridge modal"
          onPress={onClose}
          style={styles.backdropDismissArea}
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[styles.handleBar, { backgroundColor: colors.border }]}
          />

          <View style={styles.headerRow}>
            <View style={styles.headerTitleBlock}>
              <Text style={[styles.sheetTitle, { color: colors.primary }]}>
                🌉 Curiosity Bridge
              </Text>
              <Text style={[styles.sheetSubtitle, { color: colors.secondary }]}>
                Warm, zero-pressure conversation prompts
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Curiosity Bridge"
              onPress={onClose}
              style={styles.closeIconButton}
            >
              <Ionicons name="close" size={22} color={colors.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Non-judgmental anonymization guarantee */}
            <View
              style={[
                styles.guaranteeCard,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={colors.accentCool}
              />
              <Text
                style={[styles.guaranteeText, { color: colors.secondary }]}
              >
                One of you felt drawn to this and the other felt open to
                exploring. Exact numeric ratings and who rated which way are
                never shown.
              </Text>
            </View>

            {/* Optional item selector pills if multiple Curiosity Bridge items exist */}
            {pool.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.itemPillsRow}
              >
                {pool.map((entry, idx) => {
                  const isSelected =
                    entry.library_item_id === activeItem?.library_item_id;
                  return (
                    <Pressable
                      key={entry.library_item_id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Select Curiosity Bridge item ${idx + 1}: ${entry.title}`}
                      onPress={() => setSelectedId(entry.library_item_id)}
                      style={[
                        styles.itemPill,
                        {
                          backgroundColor: isSelected
                            ? colors.accentWarm
                            : colors.bg,
                          borderColor: isSelected
                            ? colors.accentWarm
                            : colors.border,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.itemPillText,
                          { color: isSelected ? '#FFFFFF' : colors.primary },
                        ]}
                      >
                        {entry.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {/* Active Curiosity Bridge Item Card */}
            {activeItem ? (
              <View
                style={[
                  styles.activeItemCard,
                  {
                    backgroundColor: colors.bg,
                    borderColor: colors.accentWarm,
                  },
                ]}
              >
                <View style={styles.itemBadgeRow}>
                  <View
                    style={[
                      styles.tierBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text style={styles.tierBadgeText}>
                      {activeItem.tier.toUpperCase()}
                    </Text>
                  </View>
                  {activeItem.category ? (
                    <View
                      style={[
                        styles.categoryPill,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.categoryPillText,
                          { color: colors.secondary },
                        ]}
                      >
                        {activeItem.category}
                      </Text>
                    </View>
                  ) : null}
                  <Text
                    style={[styles.anonymizedTag, { color: colors.accentCool }]}
                  >
                    🔒 Direction & scores hidden
                  </Text>
                </View>

                <Text
                  style={[styles.activeItemTitle, { color: colors.primary }]}
                >
                  {activeItem.title}
                </Text>
              </View>
            ) : null}

            {/* 3 Gentle Conversation Prompts */}
            <Text style={[styles.sectionHeading, { color: colors.primary }]}>
              3 Gentle Conversation Prompts
            </Text>

            <View style={styles.scriptsColumn}>
              {CURIOSITY_BRIDGE_SCRIPTS.map((script, idx) => {
                const isSelected = script.id === selectedScriptId;
                return (
                  <Pressable
                    key={script.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Conversation prompt ${idx + 1}: ${script.title}`}
                    onPress={() => setSelectedScriptId(script.id)}
                    style={[
                      styles.scriptCard,
                      {
                        backgroundColor: colors.bg,
                        borderColor: isSelected
                          ? colors.accentWarm
                          : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.scriptHeaderRow}>
                      <Text
                        style={[styles.scriptTitle, { color: colors.primary }]}
                      >
                        {idx + 1}. {script.title}
                      </Text>
                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.accentWarm}
                        />
                      ) : null}
                    </View>
                    <Text
                      selectable
                      style={[styles.scriptPrompt, { color: colors.primary }]}
                    >
                      {script.prompt}
                    </Text>
                    <Text
                      style={[styles.scriptTip, { color: colors.secondary }]}
                    >
                      💡 {script.tip}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {/* Bottom Action Buttons */}
          <View
            style={[
              styles.footerActions,
              { borderTopColor: colors.border },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Talk about it together"
              onPress={handleTalkAboutIt}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name="chatbubbles-outline"
                size={20}
                color="#FFFFFF"
              />
              <Text style={styles.primaryButtonText}>Talk about it</Text>
            </Pressable>

            <View style={styles.secondaryButtonsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Park this for now"
                onPress={handleParkForNow}
                style={({ pressed }) => [
                  styles.secondaryOutlineButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.bg,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="bookmark-outline"
                  size={16}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.secondaryOutlineText,
                    { color: colors.primary },
                  ]}
                >
                  Park this for now
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discuss in Journal"
                onPress={handleDiscussInJournal}
                style={({ pressed }) => [
                  styles.secondaryOutlineButton,
                  {
                    borderColor: colors.accentCool,
                    backgroundColor: colors.bg,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="journal-outline"
                  size={16}
                  color={colors.accentCool}
                />
                <Text
                  style={[
                    styles.secondaryOutlineText,
                    { color: colors.accentCool },
                  ]}
                >
                  Discuss in Journal
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  backdropDismissArea: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  handleBar: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: SPACING.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  headerTitleBlock: {
    flex: 1,
  },
  sheetTitle: {
    ...TYPOGRAPHY.h2,
  },
  sheetSubtitle: {
    ...TYPOGRAPHY.caption,
  },
  closeIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    marginVertical: SPACING.xs,
  },
  scrollContent: {
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  guaranteeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
  },
  guaranteeText: {
    ...TYPOGRAPHY.caption,
    flex: 1,
    lineHeight: 19,
  },
  itemPillsRow: {
    gap: SPACING.xs,
    paddingVertical: 2,
  },
  itemPill: {
    maxWidth: 220,
    minHeight: 40,
    paddingHorizontal: SPACING.sm,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemPillText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  activeItemCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: SPACING.sm,
  },
  itemBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tierBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  categoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  anonymizedTag: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  activeItemTitle: {
    ...TYPOGRAPHY.h3,
  },
  sectionHeading: {
    ...TYPOGRAPHY.h3,
    marginTop: 4,
  },
  scriptsColumn: {
    gap: SPACING.xs,
  },
  scriptCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: SPACING.sm,
    gap: 6,
  },
  scriptHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scriptTitle: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  scriptPrompt: {
    ...TYPOGRAPHY.body,
    fontStyle: 'italic',
  },
  scriptTip: {
    ...TYPOGRAPHY.caption,
  },
  footerActions: {
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    gap: SPACING.xs,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  secondaryButtonsRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  secondaryOutlineButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.xs,
  },
  secondaryOutlineText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
});

export default MismatchBridgeModal;
