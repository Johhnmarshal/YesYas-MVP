import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PairingStatus } from '@/lib/database.types';
import {
  type PairingWithPartner,
  updatePairingStatus,
  describePairingError,
} from '@/lib/pairing';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export interface PairingManageModalProps {
  visible: boolean;
  pairing: PairingWithPartner | null;
  onClose: () => void;
  onStatusChanged?: (newStatus: PairingStatus) => void;
  onUpdated?: () => void;
}

function formatPairedDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return 'Recently';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Bottom-sheet style modal to inspect, pause, resume, or dissolve an active,
 * paused, or pending pairing via `updatePairingStatus(pairing.id, newStatus)`.
 * Includes a two-step confirmation flow before ending a pairing.
 */
export function PairingManageModal({
  visible,
  pairing,
  onClose,
  onStatusChanged,
  onUpdated,
}: PairingManageModalProps) {
  const colors = useThemeColors();
  const [confirmingDissolve, setConfirmingDissolve] = useState(false);
  const [submittingStatus, setSubmittingStatus] =
    useState<PairingStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setConfirmingDissolve(false);
      setSubmittingStatus(null);
      setErrorMessage(null);
    }
  }, [visible]);

  if (!pairing) {
    return null;
  }

  const partnerName = pairing.partner_display_name?.trim() || 'Your partner';
  const isPending = pairing.status === 'pending';
  const isPaused = pairing.status === 'paused';
  const isActive = pairing.status === 'active';
  const isBusy = submittingStatus !== null;

  async function handleStatusTransition(targetStatus: PairingStatus) {
    if (!pairing || isBusy) return;
    setSubmittingStatus(targetStatus);
    setErrorMessage(null);

    try {
      await updatePairingStatus(pairing.id, targetStatus);
      onStatusChanged?.(targetStatus);
      onUpdated?.();
      setConfirmingDissolve(false);
      onClose();
    } catch (err) {
      setErrorMessage(
        describePairingError(err, 'Could not update pairing status. Please try again.'),
      );
    } finally {
      setSubmittingStatus(null);
    }
  }

  const statusLabel = isActive
    ? 'Active'
    : isPaused
      ? 'Paused'
      : isPending
        ? 'Pending Invite'
        : 'Ended';

  const statusBadgeColor = isActive
    ? colors.success
    : isPaused
      ? colors.accentWarm
      : colors.accentCool;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!isBusy) onClose();
      }}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close pairing details modal"
          disabled={isBusy}
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
                {isPending ? 'Pending Partner Invite' : `Paired with ${partnerName}`}
              </Text>
              <Text style={[styles.dateText, { color: colors.secondary }]}>
                {isPending ? 'Created' : 'Paired since'}{' '}
                {formatPairedDate(pairing.created_at)}
              </Text>
            </View>

            <View
              style={[
                styles.statusBadge,
                {
                  borderColor: statusBadgeColor,
                  backgroundColor: colors.bg,
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: statusBadgeColor },
                ]}
              />
              <Text
                style={[styles.statusBadgeText, { color: statusBadgeColor }]}
              >
                {statusLabel}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: colors.bg,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={colors.accentCool}
            />
            <Text style={[styles.infoCardText, { color: colors.secondary }]}>
              {isPaused
                ? 'Your pairing is paused. No new reveals can be triggered until you or your partner resume. Your private ratings and notes remain untouched.'
                : isPending
                  ? 'Your partner has not accepted this invite yet. You can cancel this invite at any time.'
                  : 'Pause is always one tap away. Pausing temporarily halts reveals without deleting shared history or private ratings.'}
            </Text>
          </View>

          {errorMessage ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.error,
                },
              ]}
            >
              <Text style={[styles.errorBannerText, { color: colors.error }]}>
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {!confirmingDissolve ? (
            <View style={styles.actionsColumn}>
              {(isActive || isPaused) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isActive ? 'Pause pairing' : 'Resume pairing'
                  }
                  disabled={isBusy}
                  onPress={() =>
                    void handleStatusTransition(isActive ? 'paused' : 'active')
                  }
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed || isBusy ? 0.8 : 1,
                    },
                  ]}
                >
                  {submittingStatus === 'paused' ||
                  submittingStatus === 'active' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons
                        name={
                          isActive
                            ? 'pause-circle-outline'
                            : 'play-circle-outline'
                        }
                        size={20}
                        color="#FFFFFF"
                      />
                      <Text style={styles.primaryButtonText}>
                        {isActive ? 'Pause Pairing' : 'Resume Pairing'}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isPending
                    ? 'Cancel pending invite'
                    : 'End pairing (opens confirmation)'
                }
                disabled={isBusy}
                onPress={() => setConfirmingDissolve(true)}
                style={({ pressed }) => [
                  styles.destructiveOutlineButton,
                  {
                    borderColor: colors.error,
                    opacity: pressed || isBusy ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={20}
                  color={colors.error}
                />
                <Text
                  style={[
                    styles.destructiveOutlineButtonText,
                    { color: colors.error },
                  ]}
                >
                  {isPending ? 'Cancel Pending Invite' : 'End Pairing'}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                disabled={isBusy}
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeLinkButton,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={[styles.closeLinkText, { color: colors.secondary }]}
                >
                  Keep as is
                </Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={[
                styles.confirmBox,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.error,
                },
              ]}
            >
              <Text style={[styles.confirmTitle, { color: colors.error }]}>
                {isPending
                  ? 'Cancel this invite code?'
                  : `End pairing with ${partnerName}?`}
              </Text>
              <Text
                style={[styles.confirmDescription, { color: colors.secondary }]}
              >
                {isPending
                  ? 'This invite code will immediately stop working. You can generate a fresh code whenever you are ready.'
                  : 'Ending a pairing permanently closes this shared connection and logs a pairing_ended event in both consent histories. Your solo Desire Library ratings and private Journal entries remain safely yours.'}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isPending
                    ? 'Confirm cancel invite'
                    : 'Confirm end pairing permanently'
                }
                disabled={isBusy}
                onPress={() => void handleStatusTransition('ended')}
                style={({ pressed }) => [
                  styles.destructiveConfirmButton,
                  {
                    backgroundColor: colors.error,
                    opacity: pressed || isBusy ? 0.8 : 1,
                  },
                ]}
              >
                {submittingStatus === 'ended' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.destructiveConfirmButtonText}>
                    {isPending
                      ? 'Yes, Cancel Invite'
                      : 'Confirm End Pairing'}
                  </Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back and keep pairing"
                disabled={isBusy}
                onPress={() => setConfirmingDissolve(false)}
                style={({ pressed }) => [
                  styles.closeLinkButton,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.closeLinkText, { color: colors.primary }]}>
                  Go back — Keep pairing
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  backdropDismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  handleBar: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  headerTitleBlock: {
    flex: 1,
  },
  sheetTitle: {
    ...TYPOGRAPHY.h2,
    marginBottom: 2,
  },
  dateText: {
    ...TYPOGRAPHY.caption,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBadgeText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  infoCardText: {
    ...TYPOGRAPHY.caption,
    flex: 1,
  },
  errorBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  errorBannerText: {
    ...TYPOGRAPHY.caption,
  },
  actionsColumn: {
    gap: SPACING.xs,
  },
  primaryButton: {
    minHeight: 56,
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
  destructiveOutlineButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  destructiveOutlineButtonText: {
    ...TYPOGRAPHY.button,
  },
  closeLinkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  closeLinkText: {
    ...TYPOGRAPHY.button,
  },
  confirmBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    gap: SPACING.xs,
  },
  confirmTitle: {
    ...TYPOGRAPHY.h3,
  },
  confirmDescription: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.xs,
  },
  destructiveConfirmButton: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  destructiveConfirmButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
});

export default PairingManageModal;
