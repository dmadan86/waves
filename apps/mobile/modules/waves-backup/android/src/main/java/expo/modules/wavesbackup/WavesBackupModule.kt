package expo.modules.wavesbackup

import android.content.Intent
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class WavesBackupModule : Module() {
  companion object {
    @Volatile var live: WavesBackupModule? = null
  }

  fun cancel() { sendEvent("cancel", emptyMap<String, String>()) }
  fun timeout() { sendEvent("timeout", emptyMap<String, String>()) }

  override fun definition() = ModuleDefinition {
    Name("WavesBackup")
    Events("cancel", "timeout")
    OnCreate { live = this@WavesBackupModule }
    OnDestroy { if (live === this@WavesBackupModule) live = null }

    AsyncFunction("start") { labels: Map<String, String> ->
      val context = appContext.reactContext ?: error("Backup context unavailable")
      BackupService.terminal = null
      val intent = Intent(context, BackupService::class.java)
        .putExtra("labels", JSONObject(labels).toString())
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (e: Exception) {
        Log.w("WavesBackup", "start service failed: " + e.javaClass.simpleName + ": " + e.message)
        throw e
      }
    }
    Function("update") { status: String, percent: Int ->
      BackupService.live?.update(status, percent)
    }
    Function("stop") { status: String ->
      BackupService.terminal = status
      BackupService.live?.finish(status)
    }
  }
}
