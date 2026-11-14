# Lets the Expo capture module (apps/mobile/modules/triage-capture) link the same sources
# that SwiftPM builds on the Mac. Wired in through expo-build-properties `ios.extraPods`.
Pod::Spec.new do |s|
  s.name           = 'SignalEngine'
  s.version        = '0.1.0'
  s.summary        = 'Triage Cam signal engine: heart rate, breathing rate and beat intervals from frame records'
  s.author         = 'Triage Cam'
  s.homepage       = 'https://example.invalid/triagecam'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.swift_version  = '6.0'
  s.static_framework = true
  s.frameworks     = 'Accelerate'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = 'Sources/SignalEngine/*.swift'
end
