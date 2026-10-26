package expo.modules.wavesupi

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URLDecoder

/** Returns unverified callback fields for UTR prefill only; never confirms payment. */
class WavesUpiModule : Module() {
  companion object {
    private const val REQUEST_CODE = 0x5755
    private val RESPONSE_KEYS = listOf("txnId", "responseCode", "Status", "txnRef", "ApprovalRefNo")
  }

  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("WavesUpi")

    AsyncFunction("launchUpi") { uri: String, promise: Promise ->
      if (pending != null) {
        promise.reject("ERR_UPI_BUSY", "A UPI handoff is already open", null)
        return@AsyncFunction
      }
      val parsed = Uri.parse(uri)
      if (parsed.scheme != "upi" || parsed.host != "pay") {
        promise.reject("ERR_UPI_URI", "Expected a upi://pay URI", null)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pending = promise
      try {
        @Suppress("DEPRECATION")
        activity.startActivityForResult(Intent(Intent.ACTION_VIEW, parsed), REQUEST_CODE)
      } catch (_: ActivityNotFoundException) {
        pending = null
        promise.resolve(null)
      } catch (error: Exception) {
        pending = null
        promise.reject("ERR_UPI_LAUNCH", "Could not launch UPI app", error)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      // Ignore even a SUCCESS payload if Android reports cancellation.
      val raw = if (payload.resultCode == Activity.RESULT_OK) {
        payload.data?.getStringExtra("response")
      } else null
      promise.resolve(parseResponse(raw))
    }

    OnDestroy {
      pending?.resolve(null)
      pending = null
    }
  }

  private fun decode(value: String): String = try {
    URLDecoder.decode(value, "UTF-8")
  } catch (_: IllegalArgumentException) {
    value
  }

  private fun parseResponse(raw: String?): Map<String, String>? {
    if (raw.isNullOrEmpty()) return null
    val result = mutableMapOf<String, String>()
    for (part in raw.split('&')) {
      val separator = part.indexOf('=')
      if (separator < 0) continue
      val name = decode(part.substring(0, separator))
      val key = RESPONSE_KEYS.firstOrNull { it.equals(name, ignoreCase = true) } ?: continue
      result[key] = decode(part.substring(separator + 1))
    }
    return result.takeIf { it.isNotEmpty() }
  }
}
