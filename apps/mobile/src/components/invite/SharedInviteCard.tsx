import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, View, type TextProps } from 'react-native';

import { Avatar, Text, useTheme } from '@waves/ui';

import { InviteQr } from './InviteQr';
import { inviteCardBackground } from './inviteCardBackgrounds';
import { TYPE_ICON } from './inviteCardModel';

/** The shared image is portrait 2:3, laid out in dp and captured at a higher pixel size. */
export const SHARED_CARD_WIDTH = 360;
export const SHARED_CARD_HEIGHT = 540;

const CREAM = '#FBF4EA';
const NAVY = '#14123A';
const MUTED = '#5F5C7A';
const LAVENDER_SOFT = '#ECE7FF';
const LAVENDER_PALE = '#F1EDFF';
const YELLOW = '#F5B400';
const GREEN = '#22A559';

export interface SharedInviteCardProps {
  readonly groupType: string | null | undefined;
  readonly groupName: string;
  /** "3 people already here", already worded; null hides the line. */
  readonly peopleLine: string | null;
  readonly faces: readonly {
    readonly id: string;
    readonly name: string;
    readonly ghost: boolean;
  }[];
  readonly link: string;
  /** "to join the trip on Waves", already worded. */
  readonly subtitle: string;
  readonly strings: {
    readonly scanTitle: string;
    readonly or: string;
    readonly joinLink: string;
    readonly copy: string;
    readonly noApp: string;
    readonly joinFast: string;
    readonly startSplitting: string;
  };
}

/** Text that ignores the system font scale: this is a picture, not a screen. */
function T({ style, ...rest }: TextProps & { style?: object }) {
  return <Text maxFontSizeMultiplier={1} style={[{ color: NAVY }, style]} {...rest} />;
}

/**
 * The picture that goes out when an invite is shared: a fixed 360x540 portrait
 * built to the design mockup, with the group's artwork behind it.
 *
 * It is rendered off-screen by the invite screen and captured; it is never
 * shown. Colours are fixed rather than themed, because the image must look the
 * same whatever the sender's theme (a QR on a dark ground does not scan).
 */
export function SharedInviteCard({
  groupType,
  groupName,
  peopleLine,
  faces,
  link,
  subtitle,
  strings,
}: SharedInviteCardProps) {
  const theme = useTheme();
  const brand = theme.color.brand;
  return (
    <View
      style={{
        width: SHARED_CARD_WIDTH,
        height: SHARED_CARD_HEIGHT,
        backgroundColor: CREAM,
        overflow: 'hidden',
      }}
    >
      <Image
        source={inviteCardBackground(groupType)}
        accessible={false}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, start: 0, width: '100%', height: '100%' }}
      />
      {/* Clear over the art at the top, warm cream from the QR card down. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(251,244,234,0)', 'rgba(251,244,234,0.55)', CREAM]}
        locations={[0.2, 0.42, 0.62]}
        style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}
      />

      <View style={{ flex: 1, paddingHorizontal: 19, paddingTop: 54, paddingBottom: 14 }}>
        {/* Header: badge, name and who is here, then the faces. */}
        <View style={{ alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: LAVENDER_SOFT,
              }}
            >
              <Ionicons name={TYPE_ICON[groupType ?? ''] ?? 'people'} size={20} color={brand} />
            </View>
            <View style={{ flexShrink: 1 }}>
              <T style={{ fontSize: 24, lineHeight: 28, fontWeight: '800' }} numberOfLines={1}>
                {groupName}
              </T>
              {peopleLine ? (
                <T style={{ fontSize: 12, lineHeight: 16, color: MUTED }} numberOfLines={1}>
                  {peopleLine}
                </T>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {faces.map((member, index) => (
              <View
                key={member.id}
                style={{
                  marginStart: index === 0 ? 0 : -6,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: '#ffffff',
                }}
              >
                <Avatar name={member.name} ghost={member.ghost} size={26} />
              </View>
            ))}
            <View
              style={{
                marginStart: faces.length > 0 ? -6 : 0,
                width: 30,
                height: 30,
                borderRadius: 15,
                borderWidth: 2,
                borderColor: '#ffffff',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#E4E7F2',
              }}
            >
              <Ionicons name="add" size={16} color={MUTED} />
            </View>
          </View>
        </View>

        {/* The QR card. */}
        <View
          style={{
            marginTop: 18,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 24,
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.88)',
          }}
        >
          <InviteQr link={link} size={124} />
          <T style={{ fontSize: 16, lineHeight: 20, fontWeight: '800' }}>{strings.scanTitle}</T>
          <T style={{ fontSize: 13, lineHeight: 17, color: MUTED }}>{subtitle}</T>
        </View>

        {/* "or" */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: '#D9D3C6' }} />
          <T style={{ fontSize: 11, lineHeight: 14, color: MUTED }}>{strings.or}</T>
          <View style={{ flex: 1, height: 1, backgroundColor: '#D9D3C6' }} />
        </View>

        {/* The link, in full, with a decorative Copy pill. */}
        <View
          style={{
            marginTop: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 9,
            paddingHorizontal: 10,
            borderRadius: 16,
            backgroundColor: LAVENDER_PALE,
          }}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: LAVENDER_SOFT,
            }}
          >
            <Ionicons name="link" size={15} color={brand} />
          </View>
          <View style={{ flex: 1 }}>
            <T style={{ fontSize: 12, lineHeight: 16, fontWeight: '600' }}>{strings.joinLink}</T>
            <T style={{ fontSize: 9, lineHeight: 12, color: MUTED }}>{link}</T>
          </View>
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
              backgroundColor: brand,
            }}
          >
            <T style={{ fontSize: 12, lineHeight: 15, fontWeight: '700', color: '#ffffff' }}>
              {strings.copy}
            </T>
          </View>
        </View>

        {/* Three promises, divided by hairlines. */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Promise icon="flash" color={YELLOW} label={strings.noApp} />
          <Divider />
          <Promise icon="people" color={brand} label={strings.joinFast} />
          <Divider />
          <Promise icon="shield-checkmark" color={GREEN} label={strings.startSplitting} />
        </View>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={{ width: 1, height: 26, backgroundColor: '#D9D3C6' }} />;
}

function Promise({
  icon,
  color,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 4,
      }}
    >
      <Ionicons name={icon} size={20} color={color} />
      <T style={{ flexShrink: 1, fontSize: 10, lineHeight: 13 }} numberOfLines={3}>
        {label}
      </T>
    </View>
  );
}
