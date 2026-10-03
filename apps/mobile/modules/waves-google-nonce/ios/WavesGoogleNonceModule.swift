import ExpoModulesCore
import GoogleSignIn

/**
 * Presents Google's native sheet with the nonce hash this app generated for
 * the attempt, rather than the one `GIDSignIn` invents when nobody supplies
 * one.
 *
 * `@react-native-google-signin/google-signin`'s own `signIn()` has no nonce
 * parameter (checked against the version this app pins: its `SignInParams`
 * is `loginHint` and nothing else), so on a current `GoogleSignIn-iOS` SDK the
 * token it returns still carries a `nonce` claim — `GIDSignIn` falls through
 * to AppAuth's own default, which fills one in whenever the request names
 * none — and that value is generated inside AppAuth and never hands anything
 * back to the app. There is no raw value this app can give Supabase to match
 * it, which is the production incident this module exists to close (Supabase
 * auth logs: "Passed nonce and nonce in id_token should either both exist or
 * not", with `external_google_skip_nonce_check` the stopgap while this ships).
 *
 * `GIDSignIn.sharedInstance.signIn(withPresenting:hint:additionalScopes:nonce:)`
 * (GIDSignIn 7.1+/8.x+; this app's lockfile already resolves `GoogleSignIn` to
 * ~> 9.0 through the RN wrapper's own podspec) takes the hash this module is
 * given, puts it in the authorization request verbatim, and Google mirrors it
 * into the ID token's `nonce` claim — which `nativeIdentity.ts` then checks
 * for before handing Supabase the one raw value it keeps.
 *
 * This module never calls `GoogleSignin.configure(...)` itself. The RN
 * wrapper still does, same as before this existed, and that is what sets
 * `GIDSignIn.sharedInstance.configuration` — the two share one `GIDSignIn`
 * singleton, so this only replaces the one call the wrapper cannot make.
 *
 * UNVERIFIED: written without Xcode (no native build tooling in this
 * environment). Build on a Mac/EAS and exercise a real sign-in before trusting
 * it; `nativeIdentity.ts` falls back to the wrapper's own `signIn()` if this
 * module is ever missing, so a build that skipped that step costs nothing
 * worse than today's behavior.
 */
public final class WavesGoogleNonceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WavesGoogleNonce")

    AsyncFunction("signIn") { (hashedNonce: String) -> [String: Any?] in
      let presenter = await MainActor.run { Utilities().currentViewController() }
      guard let presenter else {
        throw NoPresenterException()
      }

      do {
        let result: GIDSignInResult = try await withCheckedThrowingContinuation { continuation in
          GIDSignIn.sharedInstance.signIn(
            withPresenting: presenter,
            hint: nil,
            additionalScopes: [],
            nonce: hashedNonce
          ) { signInResult, error in
            if let error {
              continuation.resume(throwing: error)
            } else if let signInResult {
              continuation.resume(returning: signInResult)
            } else {
              continuation.resume(throwing: NoIdTokenException())
            }
          }
        }

        guard let idToken = result.user.idToken?.tokenString else {
          throw NoIdTokenException()
        }
        return ["idToken": idToken]
      } catch let error as NSError where error.domain == "com.google.GIDSignIn" && error.code == -5 {
        // kGIDSignInErrorDomain / kGIDSignInErrorCodeCanceled, spelled out as
        // literals: GoogleSignIn-iOS does not give Swift a symbol for either,
        // only the NS_ERROR_ENUM typedef used on the Objective-C side.
        throw SignInCanceledException()
      }
    }
  }
}

final class NoPresenterException: Exception {
  override var reason: String {
    "No presenting view controller found. Cannot present sign-in UI."
  }
}

final class NoIdTokenException: Exception {
  override var reason: String {
    "Google sign-in returned no identity token."
  }
}

final class SignInCanceledException: Exception {
  override var code: String { "ERR_CANCELED" }
  override var reason: String {
    "The user canceled the sign in request."
  }
}
