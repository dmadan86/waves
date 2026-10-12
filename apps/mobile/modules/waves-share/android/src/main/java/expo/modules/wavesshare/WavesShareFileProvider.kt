package expo.modules.wavesshare

import androidx.core.content.FileProvider

/** A subclass so the manifest entry is unique to this module and cannot merge with another FileProvider. */
class WavesShareFileProvider : FileProvider()
