package expo.modules.wavesinstallreferrer

import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The `referrer` a Google Play install carried, as the raw string.
 *
 * A friend's link on the web adds `&referrer=waves_ref%3DCODE` to the Play
 * Store URL; Play keeps it with the install and hands it back here on first
 * launch. Reading it is the only way a code survives the trip through the
 * store. Resolves null on every failure (no Play, not installed from Play,
 * service unavailable, an exception): nothing here is ever worth an error.
 */
class WavesInstallReferrerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WavesInstallReferrer")

    AsyncFunction("getInstallReferrer") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      // Settle exactly once, however many callbacks Play fires.
      val settled = AtomicBoolean(false)
      fun settle(value: String?) {
        if (settled.compareAndSet(false, true)) promise.resolve(value)
      }
      try {
        val client = InstallReferrerClient.newBuilder(context).build()
        client.startConnection(
          object : InstallReferrerStateListener {
            override fun onInstallReferrerSetupFinished(responseCode: Int) {
              var referrer: String? = null
              try {
                if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                  referrer = client.installReferrer.installReferrer
                }
              } catch (_: Exception) {
                referrer = null
              }
              try {
                client.endConnection()
              } catch (_: Exception) {
                // Already closed.
              }
              settle(referrer)
            }

            override fun onInstallReferrerServiceDisconnected() {
              settle(null)
            }
          },
        )
      } catch (_: Exception) {
        settle(null)
      }
    }
  }
}
