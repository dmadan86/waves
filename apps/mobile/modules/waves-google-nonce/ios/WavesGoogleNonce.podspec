require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json'))) rescue { 'version' => '1.0.0' }

Pod::Spec.new do |s|
  s.name           = 'WavesGoogleNonce'
  s.version        = package['version'] || '1.0.0'
  s.summary        = 'Google sign-in through GIDSignIn directly, with a caller-supplied nonce.'
  s.description    = 'Calls GIDSignIn.sharedInstance.signIn(withPresenting:hint:additionalScopes:nonce:) so the ID token carries this app’s own nonce hash — the free @react-native-google-signin/google-signin signIn() has no nonce parameter to ask for this with.'
  s.author         = 'Waves'
  s.homepage       = 'https://wavs.co.in'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # No version pin: CocoaPods resolves this to whatever
  # @react-native-google-signin/google-signin already requires (~> 9.0 at the
  # time of writing), so both pods share one GIDSignIn instance and one
  # `GoogleSignin.configure(...)` call.
  s.dependency 'GoogleSignIn'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
