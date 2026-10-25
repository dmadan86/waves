package expo.modules.wavesbackup

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log

/** No payload, credentials or account identifiers cross this boundary. */
class BackupService : Service() {
  companion object {
    @Volatile var terminal: String? = null
    @Volatile var live: BackupService? = null
    const val ID = 7042
  }
  private val handler = android.os.Handler(android.os.Looper.getMainLooper())
  private val runTimeout = Runnable { Log.w("WavesBackup", "runTimeout"); WavesBackupModule.live?.timeout(); finish("failed") }
  private val pauseTimeout = Runnable { Log.w("WavesBackup", "pauseTimeout"); WavesBackupModule.live?.timeout(); finish("failed") }
  private var started = false
  private var wakeLock: android.os.PowerManager.WakeLock? = null
  private var lastUpdate = 0L
  private var labels = org.json.JSONObject()
  private var lastStatus = ""
  private val manager get() = getSystemService(NotificationManager::class.java)
  override fun onCreate() {
    super.onCreate()
    live = this
    handler.postDelayed(runTimeout, 6 * 60 * 60 * 1000L)
    wakeLock = (getSystemService(POWER_SERVICE) as android.os.PowerManager)
      .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Waves:Backup").apply { acquire(6 * 60 * 60 * 1000L) }
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("backup", "Backup", NotificationManager.IMPORTANCE_LOW))
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "cancel") {
      WavesBackupModule.live?.cancel()
      if (!started) stopSelf()
      return START_NOT_STICKY
    }
    intent?.getStringExtra("labels")?.let { labels = org.json.JSONObject(it) }
    started = true
    val notification = notification("preparing", -1)
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else startForeground(ID, notification)
    } catch (e: Exception) {
      Log.w("WavesBackup", "startForeground failed: " + e.javaClass.simpleName)
      finish("failed")
      return START_NOT_STICKY
    }
    terminal?.let { finish(it) }
    return START_NOT_STICKY
  }
  private fun notification(status: String, percent: Int): Notification {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("waves://settings/backup")).setPackage(packageName)
    val tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val cancel = PendingIntent.getService(this, 1, Intent(this, BackupService::class.java).setAction("cancel"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val active = status in listOf("preparing", "uploading", "paused")
    val title = labels.optString(status, "Waves")
    val body = labels.optString("${status}Body", "")
    val text = if (status == "uploading" && percent >= 0) "$body - $percent%" else body
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "backup") else Notification.Builder(this)
    builder.setSmallIcon(R.drawable.ic_backup).setContentTitle(title).setContentText(text)
      .setContentIntent(tap).setOngoing(active).setOnlyAlertOnce(true).setAutoCancel(!active)
    if (active) {
      builder.setProgress(100, percent.coerceAtLeast(0), percent < 0)
      if (percent < 95) builder.addAction(Notification.Action.Builder(0, labels.optString("cancel", "Cancel"), cancel).build())
    }
    return builder.build()
  }
  fun update(status: String, percent: Int) {
    handler.removeCallbacks(pauseTimeout)
    if (status == "paused") handler.postDelayed(pauseTimeout, 60_000L)
    val now = android.os.SystemClock.elapsedRealtime()
    if (status == lastStatus && percent != 95 && now - lastUpdate < 1000) return
    lastStatus = status
    lastUpdate = now
    try { manager.notify(ID, notification(status, percent)) } catch (_: SecurityException) { }
  }
  fun finish(status: String) {
    handler.removeCallbacks(pauseTimeout)
    stopForeground(STOP_FOREGROUND_REMOVE)
    try { manager.notify(ID, notification(status, -1)) } catch (_: SecurityException) { }
    stopSelf()
  }
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.w("WavesBackup", "onTimeout")
    WavesBackupModule.live?.timeout()
    finish("failed")
  }
  override fun onDestroy() {
    handler.removeCallbacks(pauseTimeout)
    handler.removeCallbacks(runTimeout)
    wakeLock?.let { if (it.isHeld) it.release() }
    if (live === this) live = null
    super.onDestroy()
  }
  override fun onBind(intent: Intent?): IBinder? = null
}
