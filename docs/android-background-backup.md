# Android background backup

1. **Architecture.** The existing `backup/engine.ts` remains the single backup
   engine. It uses the existing personal-record snapshot, AEAD payload, recovery
   key/escrow, Drive appDataFolder, auth and strictest backup/sync network policy.
   Manual runs add an Android foreground service. A process-wide TS status store
   survives screen navigation; a device-private account-scoped interruption marker
   survives process death. Last-backup metadata is saved by the engine before it
   reports completion, independently of the screen.

2. **Files.** `apps/mobile/modules/waves-backup` owns all native changes: Expo
   autolinking config, Gradle library, manifest, Kotlin module/service and small
   notification icon. No generated Android/iOS files are changed and no config
   plugin is needed for the library's merged manifest. `backup/background.ts`,
   `native.ts`, `progress.ts` and `reconnect.ts` separate lifecycle, native bridge,
   progress/state logic and bounded reconnect waiting. The existing engine, hook,
   AutoBackup, cloud provider/HTTP seam, backup screen and four locales are updated.
   Tests exercise those seams; Vitest replaces only the native bridge by default.

3. **Manifest/permissions.** The local module declares `FOREGROUND_SERVICE`,
   `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` and `WAKE_LOCK`. The private
   non-exported service declares `dataSync`. A partial wake lock lasts only while
   the service runs, capped at six hours. Notifications are requested on Android
   13+ only from a manual backup, once per install. Denial does not stop backup:
   Android may hide the drawer notification, so progress/cancellation remain in
   the app. No storage, boot receiver or battery-exemption permission is added.

4. **Mechanism rationale.** A user-started dataSync foreground service protects
   the existing JS upload process and CPU execution while minimized/locked.
   WorkManager would require bootstrapping the authenticated JS record snapshot
   and does not guarantee immediate execution. A user-initiated transfer job would
   add a separate job lifecycle around this same short encrypted upload. Automatic
   scheduled checks still happen on foreground entry; this change does not claim
   unattended daily scheduling. No new npm or Android library dependencies.

5. **Notification states.** Channel `backup`, low importance, monochrome small
   icon; tap opens `waves://settings/backup`. Preparing is initially indeterminate;
   preparation/payload/encryption milestones precede actual XHR uploaded-byte
   progress (15–94%). Read-back/integrity verification is 95%; 100% is published
   only after the verified file's rename is acknowledged. Updates are throttled to
   one second, with immediate state/verification boundary changes. Preparing,
   uploading and actual offline waiting are ongoing. Safe phases offer Cancel;
   commit cannot be cancelled. Completed, failed/retry and cancelled are dismissible.
   Text is supplied from en/ta/hi/ar strings. Notifications/log errors contain no
   ledger data, identifiers, tokens or provider response bodies.

6. **Retry/atomicity.** Upload uses an encrypted private `.pending` name. The
   server's full read-back must match and decrypt/parse under the existing AAD
   before rename publishes it. Only then may the previous canonical file be
   deleted. Failed verification/commit/cancel removes staging best effort; the next
   run cleans an abandoned staging file. Canonical lookup orders newest first,
   including if death interrupts old-file cleanup. Offline interruption aborts the
   transfer, waits up to one minute, and retries upload once from the start.
   Native connectivity events can wake waiting JS; a native watchdog also bounds
   background waiting. A connection that violates Wi-Fi policy fails safely.
   Auth revocation keeps the existing reconnect flow. Other failures and quota
   exhaustion offer Back up now. Cancellation aborts XHR and never publishes staging.
   Process death/reboot leaves an interruption marker: app startup/backup-screen
   entry marks failure and offers a fresh retry using the current snapshot. There
   is no claim of byte-range resumption or survival after force-stop/reboot.

7. **Validation.** TypeScript passed; full Vitest passed 437 files / 5,862 tests
   (two existing TODOs); ESLint passed with zero warnings; Prettier passed. All
   commands used npx. Coverage includes stage/byte progress, throttling, transitions,
   duplicate start, cancellation, retry, interrupted-run recovery, permission
   request lifetime, timeout delivery, failed verification/commit and completion
   only after server acknowledgment. Kotlin cannot be compiled in this environment.

8. **Platform limits.** iOS has no native service and retains foreground behavior.
   Android may kill the process; a foreground service is not an execution guarantee.
   Android 15+ enforces a shared dataSync budget (six background hours per 24 hours,
   subject to platform rules). `onTimeout` signals failure/abort and immediately
   stops the service; an independent six-hour watchdog bounds older Android too.
   There is no boot/force-stop restart. Android 16 job quotas are not bypassed via
   WorkManager; this implementation uses a direct user-started service. Play release
   must declare the dataSync foreground-service use case. Native build and device
   checks remain required: Android 13 notification denial; Android 14 service type;
   Android 15/16 timeout/quota; minimize, lock, app switch, notification Cancel/tap,
   Wi-Fi loss/mobile switch, process kill/reboot, auth expiry and Drive quota.

Platform reference: [Android foreground-service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout).
