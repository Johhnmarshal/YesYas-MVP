import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type BiometricSettings,
  getBiometricSettings,
  saveBiometricSettings,
} from '@/components/BiometricGate';
import { PairingManageModal } from '@/components/PairingManageModal';
import type {
  Database,
  DesireTier,
  ToneLabel,
} from '@/lib/database.types';
import {
  type PairingWithPartner,
  fetchActivePairings,
  getActiveOrPendingPairing,
  updatePairingStatus,
} from '@/lib/pairing';
import { supabase } from '@/lib/supabase';
import {
  SPACING,
  TIER_OPTIONS,
  TONE_OPTIONS,
  TYPOGRAPHY,
  useThemeColors,
} from '@/lib/theme';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default function SettingsScreen() {
  const colors = useThemeColors();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [pairing, setPairing] = useState<PairingWithPartner | null>(null);
  const [loading, setLoading] = useState(true);

  // Security / Biometrics state
  const [biometricSettings, setBiometricSettings] =
    useState<BiometricSettings>({
      enabled: false,
      hasPin: false,
      pin: null,
    });
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Pairing Modal state
  const [pairingModalVisible, setPairingModalVisible] = useState(false);

  // Account Deletion Modal state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const loadSettingsData = useCallback(async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }
      setUserId(user.id);
      setEmail(user.email ?? null);

      // Fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profileData) {
        setProfile(profileData);
        setDisplayName(profileData.display_name ?? '');
      }

      // Fetch pairing status
      const activePairings = await fetchActivePairings(user.id);
      const currentPairing =
        activePairings[0] ?? (await getActiveOrPendingPairing(user.id));
      setPairing(currentPairing);

      // Fetch lock / biometric settings
      const bio = await getBiometricSettings();
      setBiometricSettings(bio);
    } catch (err) {
      console.warn('Failed to load settings data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSettingsData();
    }, [loadSettingsData]),
  );

  async function handleSaveDisplayName() {
    if (!userId || savingName) return;
    const trimmed = displayName.trim();
    setSavingName(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: trimmed || null })
        .eq('id', userId);

      if (error) throw error;
      Alert.alert('Saved', 'Your display name has been updated.');
    } catch (err) {
      Alert.alert(
        'Update Error',
        err instanceof Error ? err.message : 'Could not save display name.',
      );
    } finally {
      setSavingName(false);
    }
  }

  async function handleUpdateTone(newTone: ToneLabel) {
    if (!userId) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ tone_preference: newTone })
        .eq('id', userId);

      if (error) throw error;
      setProfile((prev) => (prev ? { ...prev, tone_preference: newTone } : null));
    } catch (err) {
      Alert.alert(
        'Update Error',
        err instanceof Error ? err.message : 'Could not update tone.',
      );
    }
  }

  async function handleUpdateTier(newTier: DesireTier) {
    if (!userId) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ content_tier_preference: newTier })
        .eq('id', userId);

      if (error) throw error;
      setProfile((prev) =>
        prev ? { ...prev, content_tier_preference: newTier } : null,
      );
    } catch (err) {
      Alert.alert(
        'Update Error',
        err instanceof Error ? err.message : 'Could not update tier.',
      );
    }
  }

  async function handleToggleBiometric(enabled: boolean) {
    if (enabled && !biometricSettings.hasPin) {
      setPinModalVisible(true);
      return;
    }
    try {
      await saveBiometricSettings(enabled);
      setBiometricSettings((prev) => ({ ...prev, enabled }));
    } catch (err) {
      Alert.alert(
        'Security Error',
        err instanceof Error ? err.message : 'Could not change lock setting.',
      );
    }
  }

  async function handleSavePin() {
    const trimmed = pinInput.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setPinError('PIN must be exactly 6 digits.');
      return;
    }
    try {
      await saveBiometricSettings(true, trimmed);
      setBiometricSettings({
        enabled: true,
        hasPin: true,
        pin: trimmed,
      });
      setPinModalVisible(false);
      setPinInput('');
      setPinError(null);
      Alert.alert('Lock Enabled', 'Your 6-digit PIN and device lock are now active.');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Failed to save PIN.');
    }
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/(auth)/sign-in');
        },
      },
    ]);
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText.trim() !== 'DELETE' || !userId || isDeletingAccount) {
      return;
    }
    setIsDeletingAccount(true);
    try {
      // 1. Delete user desires, journal entries, and AI flags
      await supabase.from('journal_entries').delete().eq('user_id', userId);
      await supabase.from('desires').delete().eq('user_id', userId);
      await supabase.from('ai_flags').delete().eq('user_id', userId);

      // 2. End pairing if active
      if (pairing) {
        try {
          await updatePairingStatus(pairing.id, 'ended');
        } catch {
          // ignore error if already ended
        }
      }

      // 3. Clear local encryption key & biometric lock
      await saveBiometricSettings(false, '');
      await AsyncStorage.removeItem(`@yesyas/enc_key_v1:${userId}`);

      // 4. Sign out
      await supabase.auth.signOut();
      setDeleteModalVisible(false);
      router.replace('/(auth)/sign-in');
    } catch (err) {
      Alert.alert(
        'Deletion Error',
        err instanceof Error
          ? err.message
          : 'Could not delete account. Please try again.',
      );
    } finally {
      setIsDeletingAccount(false);
    }
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg }]}
      edges={['top', 'left', 'right']}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        {loading ? (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={{ marginVertical: SPACING.xl }}
          />
        ) : (
          <>
            {/* Profile Section */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Profile & Identity
              </Text>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.muted }]}>
                  Display Name
                </Text>
                <View style={styles.inlineEditRow}>
                  <TextInput
                    style={[
                      styles.nameInput,
                      {
                        color: colors.text,
                        backgroundColor: colors.bg,
                        borderColor: colors.border,
                      },
                    ]}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Enter your name or nickname"
                    placeholderTextColor={colors.muted}
                    maxLength={50}
                    accessibilityLabel="Display name input"
                  />
                  <Pressable
                    onPress={handleSaveDisplayName}
                    disabled={savingName}
                    accessibilityRole="button"
                    accessibilityLabel="Save display name"
                    style={[
                      styles.saveButton,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    {savingName ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save</Text>
                    )}
                  </Pressable>
                </View>
              </View>

              {email && (
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.muted }]}>
                    Account Email
                  </Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {email}
                  </Text>
                </View>
              )}
            </View>

            {/* Relationship & Pairing Management */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Relationship & Pairing
              </Text>

              {pairing ? (
                <View style={styles.pairingContainer}>
                  <View style={styles.pairingStatusRow}>
                    <View style={styles.pairingInfo}>
                      <Text style={[styles.pairingPartnerName, { color: colors.text }]}>
                        {pairing.partner_display_name?.trim() ||
                          (pairing.status === 'pending'
                            ? 'Pairing Pending'
                            : 'Your Partner')}
                      </Text>
                      <Text style={[styles.pairingStatusText, { color: colors.muted }]}>
                        Status:{' '}
                        <Text
                          style={{
                            fontWeight: '600',
                            color:
                              pairing.status === 'active'
                                ? '#10B981'
                                : pairing.status === 'paused'
                                  ? '#F59E0B'
                                  : colors.primary,
                          }}
                        >
                          {pairing.status.toUpperCase()}
                        </Text>
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => setPairingModalVisible(true)}
                      style={[
                        styles.managePairingButton,
                        { borderColor: colors.border },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Manage pairing settings"
                    >
                      <Ionicons
                        name="settings-outline"
                        size={16}
                        color={colors.text}
                      />
                      <Text
                        style={[
                          styles.managePairingButtonText,
                          { color: colors.text },
                        ]}
                      >
                        Manage
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.soloModeContainer}>
                  <View style={styles.soloTextGroup}>
                    <Text style={[styles.soloTitle, { color: colors.text }]}>
                      Solo Mode Active
                    </Text>
                    <Text style={[styles.soloDescription, { color: colors.muted }]}>
                      Your ratings and reflections are 100% private. When you are
                      ready, invite a partner to discover mutual alignment.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.push('/(app)/pairing/invite' as Href)}
                    style={[
                      styles.invitePartnerButton,
                      { backgroundColor: colors.primary },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Invite a partner to pair"
                  >
                    <Ionicons name="heart-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.invitePartnerButtonText}>
                      Invite Partner
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Tone Selector */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Tone Preference
              </Text>
              <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>
                Adjust how desire titles and prompts are phrased.
              </Text>

              <View style={styles.optionsList}>
                {TONE_OPTIONS.map((opt) => {
                  const isSelected = profile?.tone_preference === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => void handleUpdateTone(opt.value)}
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: isSelected
                            ? colors.primary + '12'
                            : colors.bg,
                          borderColor: isSelected
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Set tone to ${opt.label}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionLabel,
                            {
                              color: isSelected
                                ? colors.primary
                                : colors.text,
                              fontWeight: isSelected ? '700' : '600',
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text
                          style={[styles.optionDescription, { color: colors.muted }]}
                        >
                          {opt.description}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Content Tier Selector */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Content Tier Preference
              </Text>
              <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>
                Choose the maximum depth of desire prompts shown in your library.
              </Text>

              <View style={styles.optionsList}>
                {TIER_OPTIONS.map((opt) => {
                  const isSelected =
                    profile?.content_tier_preference === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => void handleUpdateTier(opt.value)}
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: isSelected
                            ? colors.primary + '12'
                            : colors.bg,
                          borderColor: isSelected
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Set content tier to ${opt.label}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionLabel,
                            {
                              color: isSelected
                                ? colors.primary
                                : colors.text,
                              fontWeight: isSelected ? '700' : '600',
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text
                          style={[styles.optionDescription, { color: colors.muted }]}
                        >
                          {opt.description}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Device Security & Biometric Lock */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Device Security & Privacy Lock
              </Text>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switchTitle, { color: colors.text }]}>
                    Require Biometrics / 6-digit PIN
                  </Text>
                  <Text style={[styles.switchSubtitle, { color: colors.muted }]}>
                    Lock the app whenever backgrounded to protect your privacy.
                  </Text>
                </View>
                <Switch
                  value={biometricSettings.enabled}
                  onValueChange={(val) => void handleToggleBiometric(val)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Toggle biometric and PIN app lock"
                />
              </View>

              {biometricSettings.enabled && (
                <Pressable
                  onPress={() => setPinModalVisible(true)}
                  style={[
                    styles.changePinButton,
                    { borderColor: colors.border, backgroundColor: colors.bg },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Change 6-digit PIN"
                >
                  <Ionicons name="key-outline" size={16} color={colors.primary} />
                  <Text style={[styles.changePinText, { color: colors.primary }]}>
                    {biometricSettings.hasPin ? 'Change 6-Digit PIN' : 'Set 6-Digit PIN'}
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Audit & Legal Summary Navigation */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Privacy Audit & Clinical Export
              </Text>

              <Pressable
                onPress={() => router.push('/(app)/settings/consent' as Href)}
                style={[styles.navRow, { borderBottomColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel="Navigate to consent audit history"
              >
                <View style={styles.navRowLeft}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={20}
                    color={colors.primary}
                  />
                  <View>
                    <Text style={[styles.navRowTitle, { color: colors.text }]}>
                      Consent Audit Trail
                    </Text>
                    <Text style={[styles.navRowSubtitle, { color: colors.muted }]}>
                      View tamper-evident SHA-256 cryptographic chain
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>

              <Pressable
                onPress={() => router.push('/(app)/settings/export' as Href)}
                style={styles.navRow}
                accessibilityRole="button"
                accessibilityLabel="Navigate to therapist summary export"
              >
                <View style={styles.navRowLeft}>
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color={colors.primary}
                  />
                  <View>
                    <Text style={[styles.navRowTitle, { color: colors.text }]}>
                      Therapist Summary Export
                    </Text>
                    <Text style={[styles.navRowSubtitle, { color: colors.muted }]}>
                      Dual-consented aggregate report for clinical support
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* Account Actions */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Account Actions
              </Text>

              <Pressable
                onPress={handleSignOut}
                style={[
                  styles.signOutButton,
                  { borderColor: colors.border, backgroundColor: colors.bg },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Sign out of your account"
              >
                <Ionicons name="log-out-outline" size={18} color={colors.text} />
                <Text style={[styles.signOutText, { color: colors.text }]}>
                  Sign Out
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setDeleteConfirmText('');
                  setDeleteModalVisible(true);
                }}
                style={styles.deleteAccountButton}
                accessibilityRole="button"
                accessibilityLabel="Delete your account permanently"
              >
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
                <Text style={styles.deleteAccountText}>
                  Delete Account & Data
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* Pairing Management Modal */}
      <PairingManageModal
        visible={pairingModalVisible}
        pairing={pairing}
        onClose={() => setPairingModalVisible(false)}
        onUpdated={() => void loadSettingsData()}
      />

      {/* 6-Digit PIN Setup Modal */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="key" size={32} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Set 6-Digit PIN
            </Text>
            <Text style={[styles.modalBody, { color: colors.muted }]}>
              Enter a 6-digit PIN code used to unlock YesYas! if biometrics fail.
            </Text>

            <TextInput
              style={[
                styles.pinInput,
                {
                  color: colors.text,
                  backgroundColor: colors.bg,
                  borderColor: pinError ? '#EF4444' : colors.border,
                },
              ]}
              value={pinInput}
              onChangeText={(val) => {
                setPinInput(val.replace(/\D/g, '').slice(0, 6));
                setPinError(null);
              }}
              placeholder="123456"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              accessibilityLabel="6 digit PIN input"
            />

            {pinError && <Text style={styles.errorText}>{pinError}</Text>}

            <View style={styles.modalButtonRow}>
              <Pressable
                onPress={() => {
                  setPinModalVisible(false);
                  setPinInput('');
                  setPinError(null);
                }}
                style={[
                  styles.modalCancelButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.modalCancelButtonText, { color: colors.text }]}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSavePin}
                style={[
                  styles.modalConfirmButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={styles.modalConfirmButtonText}>Save PIN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Account Deletion Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.modalIconCircle,
                { backgroundColor: '#EF444420' },
              ]}
            >
              <Ionicons name="warning" size={32} color="#EF4444" />
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Delete Account Permanently
            </Text>

            <Text style={[styles.modalBody, { color: colors.muted }]}>
              This will irreversibly erase your profile, all encrypted journal
              entries, private desire ratings, and dissolve any active pairing.
            </Text>

            <Text style={[styles.deleteInstruction, { color: colors.text }]}>
              To confirm, type <Text style={{ fontWeight: '700' }}>DELETE</Text>{' '}
              below:
            </Text>

            <TextInput
              style={[
                styles.deleteInput,
                {
                  color: colors.text,
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                },
              ]}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              accessibilityLabel="Type DELETE to confirm account deletion"
            />

            <View style={styles.modalButtonRow}>
              <Pressable
                onPress={() => setDeleteModalVisible(false)}
                disabled={isDeletingAccount}
                style={[
                  styles.modalCancelButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.modalCancelButtonText, { color: colors.text }]}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleDeleteAccount}
                disabled={
                  deleteConfirmText.trim() !== 'DELETE' || isDeletingAccount
                }
                style={[
                  styles.modalConfirmButton,
                  {
                    backgroundColor:
                      deleteConfirmText.trim() === 'DELETE' && !isDeletingAccount
                        ? '#EF4444'
                        : '#EF444450',
                  },
                ]}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>
                    Confirm Delete
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
    gap: SPACING.md,
  },
  sectionCard: {
    padding: SPACING.md,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    marginBottom: SPACING.sm,
  },
  inputGroup: {
    marginTop: SPACING.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  inlineEditRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    alignItems: 'center',
  },
  nameInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    fontSize: TYPOGRAPHY.body.fontSize,
  },
  saveButton: {
    paddingHorizontal: SPACING.md,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: TYPOGRAPHY.caption.fontSize,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.sm,
    paddingTop: SPACING.xs,
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  pairingContainer: {
    marginTop: SPACING.xs,
  },
  pairingStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pairingInfo: {
    flex: 1,
  },
  pairingPartnerName: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
  },
  pairingStatusText: {
    fontSize: 13,
    marginTop: 2,
  },
  managePairingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  managePairingButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  soloModeContainer: {
    marginTop: SPACING.xs,
    gap: SPACING.sm,
  },
  soloTextGroup: {
    gap: 2,
  },
  soloTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '600',
  },
  soloDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  invitePartnerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  invitePartnerButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  optionsList: {
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionLabel: {
    fontSize: 15,
  },
  optionDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
    gap: SPACING.sm,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  switchSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  changePinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: SPACING.sm,
  },
  changePinText: {
    fontSize: 13,
    fontWeight: '600',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  navRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  navRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  navRowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  deleteAccountText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  modalBody: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: SPACING.md,
  },
  pinInput: {
    width: 180,
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22,
    letterSpacing: 8,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginBottom: SPACING.xs,
  },
  deleteInstruction: {
    fontSize: 13,
    marginBottom: SPACING.xs,
  },
  deleteInput: {
    width: '100%',
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
    marginTop: SPACING.xs,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontWeight: '600',
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
