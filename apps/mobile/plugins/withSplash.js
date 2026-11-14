// The launch screen: one colour and the mark in the middle, with no new native dependency.
//
// Expo configures the launch screen through the expo-splash-screen package, which this app
// does not have. The generated project already contains SplashScreen.storyboard and names it in
// Info.plist, so this plugin only rewrites that storyboard and adds the image it shows. It runs
// at prebuild and changes nothing until the next native build.
//
//   ["./plugins/withSplash", { "image": "./assets/splash-icon.png", "backgroundColor": "#0a0c0f", "imageSize": 200 }]
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const IMAGE_SET = 'SplashScreenLogo';

function channels(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`withSplash: backgroundColor must be a colour like #0a0c0f, not ${hex}`);
  return [0, 2, 4].map((at) => (parseInt(match[1].slice(at, at + 2), 16) / 255).toFixed(6));
}

function storyboard(backgroundColor, size) {
  const [red, green, blue] = channels(backgroundColor);
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="EXPO-VIEWCONTROLLER-1">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EXPO-SCENE-1">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="EXPO-VIEWCONTROLLER-1" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="EXPO-ContainerView" userLabel="ContainerView">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="${IMAGE_SET}" translatesAutoresizingMaskIntoConstraints="NO" id="EXPO-SplashScreen" userLabel="SplashScreen">
                                <rect key="frame" x="${(393 - size) / 2}" y="${(852 - size) / 2}" width="${size}" height="${size}"/>
                                <constraints>
                                    <constraint firstAttribute="width" constant="${size}" id="TC-SPLASH-W"/>
                                    <constraint firstAttribute="height" constant="${size}" id="TC-SPLASH-H"/>
                                </constraints>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="Rmq-lb-GrQ"/>
                        <constraints>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="centerY" secondItem="EXPO-ContainerView" secondAttribute="centerY" id="0VC-Wk-OaO"/>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="zR4-NK-mVN"/>
                        </constraints>
                        <color key="backgroundColor" red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="EXPO-PLACEHOLDER-1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="${IMAGE_SET}" width="${size}" height="${size}"/>
    </resources>
</document>
`;
}

/** Writes the launch screen into the app's folder of the generated iOS project. */
function writeSplash(appDir, imagePath, backgroundColor, imageSize) {
  if (!fs.existsSync(imagePath)) throw new Error(`withSplash: there is no image at ${imagePath}`);
  if (!fs.existsSync(path.join(appDir, 'Images.xcassets'))) throw new Error(`withSplash: there is no Images.xcassets in ${appDir}`);
  const imageSet = path.join(appDir, 'Images.xcassets', `${IMAGE_SET}.imageset`);
  fs.mkdirSync(imageSet, { recursive: true });
  fs.copyFileSync(imagePath, path.join(imageSet, 'image.png'));
  fs.writeFileSync(
    path.join(imageSet, 'Contents.json'),
    `${JSON.stringify({ images: [{ idiom: 'universal', filename: 'image.png' }], info: { version: 1, author: 'expo' } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(appDir, 'SplashScreen.storyboard'), storyboard(backgroundColor, imageSize));
}

const withSplash = (config, { image, backgroundColor, imageSize = 200 }) =>
  withDangerousMod(config, [
    'ios',
    (mod) => {
      const { projectRoot, platformProjectRoot, projectName } = mod.modRequest;
      writeSplash(path.join(platformProjectRoot, projectName), path.resolve(projectRoot, image), backgroundColor, imageSize);
      return mod;
    },
  ]);

module.exports = withSplash;
module.exports.writeSplash = writeSplash;
