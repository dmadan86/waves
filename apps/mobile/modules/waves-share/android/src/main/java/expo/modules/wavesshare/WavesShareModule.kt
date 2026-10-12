package expo.modules.wavesshare

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * One ACTION_SEND carrying an image and its text together.
 *
 * `target` picks who receives it: WhatsApp (or WhatsApp Business) directly, a
 * mail app only, or the system chooser. WhatsApp shows `EXTRA_TEXT` as the
 * image's caption; mail apps use it as the body and `EXTRA_SUBJECT` as the
 * subject. `unavailable` means the named app is not installed.
 */
class WavesShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WavesShare")

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
