Pod::Spec.new do |s|
  s.name           = 'TriageCapture'
  s.version        = '1.0.0'
  s.summary        = 'Camera capture for Triage Cam'
  s.description    = 'Rear-camera capture, face regions and the bridge to the SignalEngine package'
  s.author         = 'Triage Cam'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # packages/signal-engine, added to the Podfile by expo-build-properties (ios.extraPods in app.json).
  s.dependency 'SignalEngine'
  s.frameworks = 'AVFoundation', 'Vision', 'Accelerate', 'CoreImage'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"

  # CocoaPods lists the engine's source files when `pod install` runs. A file added to the
  # package afterwards is not compiled until it runs again, which shows up as a confusing
  # "cannot find type" error, so say what to do instead.
  s.script_phase = {
    :name => 'Check SignalEngine sources are in the Pods project',
    :execution_position => :before_compile,
    :always_out_of_date => '1',
    :script => <<-SCRIPT
      for file in "${PODS_TARGET_SRCROOT}"/../../../../../packages/signal-engine/Sources/SignalEngine/*.swift; do
        if ! grep -q "$(basename "$file")" "${PODS_ROOT}/Pods.xcodeproj/project.pbxproj"; then
          echo "error: $(basename "$file") was added to packages/signal-engine after the last pod install. Run 'pod install' in apps/mobile/ios."
          exit 1
        fi
      done
    SCRIPT
  }
end
