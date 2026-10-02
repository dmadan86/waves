package expo.modules.wavesstoreupdate

import android.app.Activity
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google Play's in-app updates, as the app's own update bar drives them.
 *
 * Play does the heavy lifting — its own "Update available" sheet, the download
 * in the background while the app stays usable, and the install that restarts
 * it. What this adds is control of the moment of restart: a flexible update
 * that has finished downloading waits here until the person taps "Restart",
 * instead of being installed out from under them mid-expense.
 *
 * Every install-state change Play reports is passed up as `onStatus`, with the
 * bytes so far, so the bar can show its progress. The result of Play's own
 * sheet comes back the same way (`ACCEPTED` / `DECLINED`), so the bar knows
 * whether to start showing a download or go back to its first state.
 *
 * Only an app installed from Google Play is ever offered an update; a build
 * installed any other way gets `available: false`, which is the honest answer.
 */
class WavesStoreUpdateModule : Module() {
  companion object {
    private const val REQUEST_CODE = 0x5741 // "WA"
  }

  private var manager: AppUpdateManager? = null

  private val listener = InstallStateUpdatedListener { state ->
    sendEvent(
      "onStatus",
      mapOf(
        "status" to statusName(state.installStatus()),
        "downloaded" to state.bytesDownloaded().toDouble(),
        "total" to state.totalBytesToDownload().toDouble(),
      ),
    )
  }

  private fun manager(): AppUpdateManager? {
    manager?.let { return it }
    val context = appContext.reactContext ?: return null
    return AppUpdateManagerFactory.create(context).also {
      it.registerListener(listener)
      manager = it
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WavesStoreUpdate")

    Events("onStatus")

    OnDestroy {
      manager?.unregisterListener(listener)
      manager = null
    }

    AsyncFunction("check") { promise: Promise ->
      val updates = manager()
      if (updates == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      updates.appUpdateInfo
        .addOnSuccessListener { info ->
          promise.resolve(
            mapOf(
              "available" to (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE),
              "inProgress" to
                (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS),
              "versionCode" to info.availableVersionCode(),
              "flexible" to info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE),
              "immediate" to info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
              "staleDays" to info.clientVersionStalenessDays(),
              "priority" to info.updatePriority(),
              "status" to statusName(info.installStatus()),
              "downloaded" to info.bytesDownloaded().toDouble(),
              "total" to info.totalBytesToDownload().toDouble(),
            ),
          )
        }
        // No Play Store, not installed from Play, offline: all of it means
        // "nothing to offer", never an error the bar has to explain.
        .addOnFailureListener { promise.resolve(null) }
    }

    AsyncFunction("start") { immediate: Boolean, promise: Promise ->
      val updates = manager()
      val activity = appContext.currentActivity
      if (updates == null || activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val type = if (immediate) AppUpdateType.IMMEDIATE else AppUpdateType.FLEXIBLE
      updates.appUpdateInfo
        .addOnSuccessListener { info ->
          val availability = info.updateAvailability()
          val resumable =
            immediate && availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          if ((availability != UpdateAvailability.UPDATE_AVAILABLE && !resumable) ||
            !info.isUpdateTypeAllowed(type)
          ) {
            promise.resolve(false)
            return@addOnSuccessListener
          }
          // Play can fail to launch its sheet (SendIntentException). Caught
          // here: this runs in a later callback, where an escaped exception
          // would leave the promise hanging and could take the app down.
          val started =
            try {
              @Suppress("DEPRECATION")
              updates.startUpdateFlowForResult(
                info,
                activity,
                AppUpdateOptions.newBuilder(type).build(),
                REQUEST_CODE,
              )
            } catch (_: Exception) {
              false
            }
          promise.resolve(started)
        }
        .addOnFailureListener { promise.resolve(false) }
    }

    // Installs a downloaded flexible update. Play shows its own "Installing…"
    // screen and the app restarts into the new version. Settles from Play's
    // own task: false when the install could not be started, so the caller
    // can ask the store again instead of leaving "Restart" doing nothing.
    AsyncFunction("complete") { promise: Promise ->
      val updates = manager()
      if (updates == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      updates.completeUpdate()
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { promise.resolve(false) }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      sendEvent(
        "onStatus",
        mapOf("status" to if (payload.resultCode == Activity.RESULT_OK) "ACCEPTED" else "DECLINED"),
      )
    }
  }

  private fun statusName(status: Int): String =
    when (status) {
      InstallStatus.PENDING -> "PENDING"
      InstallStatus.DOWNLOADING -> "DOWNLOADING"
      InstallStatus.DOWNLOADED -> "DOWNLOADED"
      InstallStatus.INSTALLING -> "INSTALLING"
      InstallStatus.INSTALLED -> "INSTALLED"
      InstallStatus.FAILED -> "FAILED"
      InstallStatus.CANCELED -> "CANCELED"
      else -> "UNKNOWN"
    }
}
