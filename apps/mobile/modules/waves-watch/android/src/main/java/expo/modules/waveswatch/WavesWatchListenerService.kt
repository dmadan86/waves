package expo.modules.waveswatch

import android.net.Uri
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.io.File

/**
 * Receives messages the Wear app sends on the `/waves` path and hands them to
 * the live [WavesWatchModule], which forwards them to JS. If the app process is
 * not running there is no live module, and the message is dropped — the v1
 * "phone must be awake" limitation.
 *
 * Also receives a voice clip the watch recorded: a Channel on `/waves/clip/<json>`
 * (the JSON is the clip's metadata: {t:"voiceClip", id, durationMs, madeAt, ...}).
 * The audio is saved to the cache and handed to JS as `onWatchFile`, the same
 * event the iOS module emits, so the phone transcribes it by the same path.
 */
class WavesWatchListenerService : WearableListenerService() {
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path != WavesWatchModule.PATH) return
    WavesWatchModule.deliver(String(event.data, Charsets.UTF_8))
  }

  override fun onChannelOpened(channel: ChannelClient.Channel) {
    if (!channel.path.startsWith(WavesWatchModule.CLIP_PATH)) return
    val file = WavesWatchModule.clipFile(this, channel.path) ?: return
    Wearable.getChannelClient(this).receiveFile(channel, Uri.fromFile(file), false)
  }

  override fun onInputClosed(channel: ChannelClient.Channel, closeReason: Int, errorCode: Int) {
    if (!channel.path.startsWith(WavesWatchModule.CLIP_PATH)) return
    val file = WavesWatchModule.clipFile(this, channel.path) ?: return
    if (closeReason == ChannelClient.ChannelCallback.CLOSE_REASON_NORMAL && file.length() > 0) {
      WavesWatchModule.deliverFile(file, WavesWatchModule.clipMetadata(channel.path))
    } else {
      file.delete()
    }
  }
}
