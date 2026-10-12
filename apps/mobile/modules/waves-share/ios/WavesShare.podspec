require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json'))) rescue { 'version' => '1.0.0' }

Pod::Spec.new do |s|
  s.name           = 'WavesShare'
  s.version        = package['version'] || '1.0.0'
  s.summary        = 'Share an image together with its text in one activity sheet or mail draft.'
  s.description    = 'Presents UIActivityViewController with the image and its caption together, or an MFMailComposeViewController with the image attached.'
  s.author         = 'Waves'
  s.homepage       = 'https://wavs.co.in'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
