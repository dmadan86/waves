/**
 * Replay of a voice note recorded on the watch, beside the watch badge in
 * Review. The file only exists on the phone that received it, so the button
 * renders nothing elsewhere.
 *
 * `expo-audio` throws at import in a binary built before it was added, and
 * expo-router loads every file at launch, so it is reached through a guarded
 * `require` as `DictateButton` does for speech recognition.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { iconSize, useTheme } from '@waves/ui';

import { keptClipUri } from '@/lib/watch/voiceClip';
import { clipOfParsed, showClipPlayer } from '@/lib/watch/voiceClipPure';

interface Player {
  play(): void;
  remove(): void;
  addListener(
    event: string,
    handler: (status: { didJustFinish?: boolean }) => void,
  ): {
    remove(): void;
  };
}

function loadAudio(): { createAudioPlayer(uri: string): Player } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-audio') as { createAudioPlayer(uri: string): Player };
  } catch {
    return null;
  }
}

/** Only one clip plays at a time: starting one stops the one before it. */
let stopActive: (() => void) | null = null;

export function WatchClipButton({
  parsed,
  label,
}: {
  parsed: unknown;
  label: string;
}): React.JSX.Element | null {
  const theme = useTheme();
  const clip = clipOfParsed(parsed);
  const [uri] = useState(() => (clip ? keptClipUri(clip) : null));
  const [audio] = useState(loadAudio);
  const [playing, setPlaying] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(
    () => () => {
      player?.remove();
    },
    [player],
  );

  if (!showClipPlayer({ clip, fileExists: uri !== null, moduleLoaded: audio !== null }))
    return null;

  const stop = (): void => {
    setPlaying(false);
    setPlayer(null);
    if (stopActive === stop) stopActive = null;
  };
  const toggle = (): void => {
    if (playing) {
      stop();
      return;
    }
    try {
      stopActive?.();
      const next = (audio as NonNullable<typeof audio>).createAudioPlayer(uri as string);
      next.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) stop();
      });
      next.play();
      setPlayer(next);
      setPlaying(true);
      stopActive = stop;
    } catch {
      stop();
    }
  };

  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons
        name={playing ? 'pause' : 'play'}
        size={iconSize.xs}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}
