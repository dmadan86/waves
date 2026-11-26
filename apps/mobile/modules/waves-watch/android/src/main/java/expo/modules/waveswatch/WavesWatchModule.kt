package expo.modules.waveswatch

import android.content.Context
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The phone end of the Wear OS relay.
 *
 * Forwards messages the Wear app sends (via [WavesWatchListenerService]) up to
 * JS as `onWatchMessage`, and sends the phone's replies back down the Wearable
 * Data Layer. All product logic is in JS (src/lib/watch/bridge.tsx); this only
 * moves JSON dictionaries.
 *
 * A single live instance is published for the listener service to reach — which
 * ties delivery to the app process being alive. Headless delivery (app killed)
 * is a deliberate v1 non-goal.
 *
 * UNVERIFIED: written on Windows with no Android build; compile on an emulator
 * before trust.
 */
class WavesWatchModule : Module() {
  companion object {
    const val PATH = "/waves"
    /** A clip channel's path is CLIP_PATH + "/" + the URL-encoded metadata JSON. */
    const val CLIP_PATH = "/waves/clip"

    @Volatile
    private var live: WavesWatchModule? = null

    // A clip can arrive before JS has subscribed (or with the app process just
    // started by the channel event); it waits here until `onWatchFile` has a
    // listener, as on iOS, so none is dropped.
    @Volatile
    private var observingFiles = false
    private val pendingFiles = ArrayList<Map<String, Any?>>()

    fun clipMetadata(path: String): JSONObject? =
      try {
        JSONObject(Uri.decode(path.removePrefix("$CLIP_PATH/")))
      } catch (_: Exception) {
        null
      }

    /** Where a clip's audio lands: named by its id, so the open and close events agree. */
    fun clipFile(context: Context, path: String): File? {
      val id = clipMetadata(path)?.optString("id").orEmpty()
      if (id.isEmpty() || id.length > 64 || !id.all { it.isLetterOrDigit() || it == '-' }) return null
      val dir = File(context.cacheDir, "watch-clips").apply { mkdirs() }
      return File(dir, "$id.m4a")
    }

    fun deliverFile(file: File, metadata: JSONObject?) {
      if (metadata == null) {
        file.delete()
        return
      }
      val payload = mapOf("uri" to Uri.fromFile(file).toString(), "metadata" to jsonToMap(metadata))
      synchronized(pendingFiles) {
        val module = live
        if (module != null && observingFiles) module.sendEvent("onWatchFile", payload)
        else pendingFiles.add(payload)
      }
    }

    /** Called by the listener service on the main process. */
    fun deliver(json: String) {
      live?.emit(json)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WavesWatch")

    Events("onWatchMessage", "onWatchFile")

    OnStartObserving("onWatchFile") {
      synchronized(pendingFiles) {
        observingFiles = true
        pendingFiles.forEach { sendEvent("onWatchFile", it) }
        pendingFiles.clear()
      }
    }

    OnStopObserving("onWatchFile") {
      observingFiles = false
    }

    OnCreate { live = this@WavesWatchModule }

    OnDestroy {
      if (live === this@WavesWatchModule) live = null
    }

    Function("isReachable") {
      // A precise reachability probe is asynchronous on Wear; the send path
      // tolerates no connected node, so report true and let the send decide.
      true
    }

    AsyncFunction("sendToWatch") { payload: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val bytes = JSONObject(payload).toString().toByteArray(Charsets.UTF_8)
      val nodeClient = Wearable.getNodeClient(context)
      val messageClient = Wearable.getMessageClient(context)
      // Runs on the module's async queue, off the JS thread, so awaiting is fine.
      val nodes = Tasks.await(nodeClient.connectedNodes)
      for (node in nodes) {
        messageClient.sendMessage(node.id, PATH, bytes)
      }
    }
  }

  private fun emit(json: String) {
    // Malformed watch JSON is dropped, never allowed to crash the phone app.
    val obj = try { JSONObject(json) } catch (_: org.json.JSONException) { return }
    sendEvent("onWatchMessage", mapOf("payload" to jsonToMap(obj)))
  }
}

/** Recursively turn org.json values into the plain maps/lists Expo can bridge. */
internal fun jsonToMap(obj: JSONObject): Map<String, Any?> {
  val out = HashMap<String, Any?>()
  for (key in obj.keys()) {
    out[key] = normalise(obj.get(key))
  }
  return out
}

private fun normalise(value: Any?): Any? =
  when (value) {
    is JSONObject -> jsonToMap(value)
    is JSONArray -> (0 until value.length()).map { normalise(value.get(it)) }
    JSONObject.NULL -> null
    else -> value
  }
