package expo.modules.wavesshare

import android.content.ClipData
import android.content.Intent
import android.content.ContentResolver
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

/**
 * One ACTION_SEND carrying an image and its text together.
 *
 * `target` picks who receives it: WhatsApp (or WhatsApp Business) directly, a
 * mail app only, or the system chooser. WhatsApp shows `EXTRA_TEXT` as the
 * image's caption; mail apps use it as the body and `EXTRA_SUBJECT` as the
 * subject. `unavailable` means the named app is not installed.
 */
class WavesShareModule : Module() {
  // The latest incoming share, already copied into the app cache. Held until JS
  // clears it, so a share that lands before JS is listening is not lost.
  private var pending: Map<String, Any?>? = null
  private val lock = Any()

  /**
   * Turns an ACTION_SEND / ACTION_SEND_MULTIPLE image intent into a cache copy.
   *
   * The content:// grant only lasts as long as the activity that received it, so
   * the bytes are copied now and JS only ever sees a file:// path of our own.
   * The intent is marked consumed (action cleared, stream removed), and an
   * intent replayed from the recents list is ignored, so one share is never
   * ingested twice.
   */
  private fun ingest(intent: Intent?): Map<String, Any?>? {
    if (intent == null) return null
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
    val action = intent.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return null
    val context = appContext.reactContext ?: return null

    @Suppress("DEPRECATION")
    val source: Uri? =
      try {
        if (action == Intent.ACTION_SEND) {
          if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        } else {
          val list =
            if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
          list?.firstOrNull()
        }
      } catch (_: Exception) {
        null
      } ?: intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri

    // Consumed whether or not the copy works: a bad share must not retry forever.
    intent.action = Intent.ACTION_MAIN
    intent.removeExtra(Intent.EXTRA_STREAM)
    if (source == null) return null
    // A sender controls this URI. Only another app's content:// provider is
    // trusted: file:// (and any other scheme) could name our private files, and
    // one of our own providers (WavesShareFileProvider, expo's) would hand them
    // over. Mirrors isAcceptableShareUri in incoming.ts.
    if (source.scheme != ContentResolver.SCHEME_CONTENT) return null
    val authority = source.authority ?: return null
    if (authority.startsWith(context.packageName)) return null

    return try {
      // The provider's own answer only; the sender-supplied intent.type is not
      // evidence of anything.
      val resolved = context.contentResolver.getType(source) ?: return null
      if (!resolved.startsWith("image/")) return null
      val ext =
        when (resolved.lowercase()) {
          "image/png" -> "png"
          "image/webp" -> "webp"
          "image/heic", "image/heif" -> "heic"
          "image/jpeg", "image/jpg" -> "jpg"
          else -> "img"
        }
      val dir = File(context.cacheDir, "incoming-share").apply { mkdirs() }
      // Older copies are of no use to anyone: one share is live at a time.
      dir.listFiles()?.forEach { it.delete() }
      val id = UUID.randomUUID().toString()
      val target = File(dir, "$id.$ext")
      val limit = 25L * 1024 * 1024
      context.contentResolver.openInputStream(source)?.use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > limit) {
              target.delete()
              return null
            }
            output.write(buffer, 0, read)
          }
        }
      } ?: return null
      // The bytes must really be an image, whatever the provider claimed.
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(target.absolutePath, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        target.delete()
        return null
      }
      mapOf("id" to id, "uri" to "file://${target.absolutePath}", "mimeType" to resolved.lowercase())
    } catch (_: Exception) {
      null
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WavesShare")

    Events("onShare")

    // The app was already running: copy off the main thread, then tell JS.
    OnNewIntent { intent ->
      Thread {
          val share = synchronized(lock) { ingest(intent)?.also { pending = it } }
          if (share != null) sendEvent("onShare", share)
        }
        .start()
    }

    // Cold start, or JS asking again after returning to the foreground.
    AsyncFunction("getInitialShare") {
      synchronized(lock) {
        if (pending == null) pending = ingest(appContext.currentActivity?.intent)
        pending
      }
    }

    AsyncFunction("clearShare") { id: String ->
      synchronized(lock) {
        if (pending?.get("id") == id) pending = null
      }
    }

    AsyncFunction("shareImageWithText") { options: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      val fileUri = options["fileUri"] as? String
      if (context == null || fileUri == null) {
        promise.resolve("unavailable")
        return@AsyncFunction
      }
      val text = options["text"] as? String ?: ""
      val subject = options["subject"] as? String ?: ""
      val mimeType = options["mimeType"] as? String ?: "image/png"
      val target = options["target"] as? String ?: "any"

      try {
        val path = Uri.parse(fileUri).path ?: fileUri
        val uri =
          FileProvider.getUriForFile(context, "${context.packageName}.wavesshare.fileprovider", File(path))

        val send =
          Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, text)
            if (subject.isNotEmpty()) putExtra(Intent.EXTRA_SUBJECT, subject)
            // The grant only reaches the receiver through the intent's ClipData.
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }

        val launch: Intent =
          when (target) {
            "whatsapp" -> {
              val pkg =
                listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { candidate ->
                  send.setPackage(candidate)
                  send.resolveActivity(context.packageManager) != null
                }
              if (pkg == null) {
                promise.resolve("unavailable")
                return@AsyncFunction
              }
              send.setPackage(pkg)
              send
            }
            "email" -> {
              val mailto = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
              if (mailto.resolveActivity(context.packageManager) == null) {
                promise.resolve("unavailable")
                return@AsyncFunction
              }
              // Only mail apps answer to the selector, so the chooser lists no
              // messengers.
              send.selector = mailto
              Intent.createChooser(send, null).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              }
            }
            else ->
              Intent.createChooser(send, null).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              }
          }

        val activity = appContext.currentActivity
        if (activity != null) {
          activity.startActivity(launch)
        } else {
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(launch)
        }
        promise.resolve("shared")
      } catch (_: Exception) {
        // Bad path, no handler, activity gone: the caller falls back to its
        // text-only or image-only share.
        promise.resolve("unavailable")
      }
    }
  }
}
