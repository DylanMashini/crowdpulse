// app.json is the configuration. This file only lets a developer point expo-router at the
// capture module's debug screen instead of the app's routes:
//
//   TRIAGECAM_CAPTURE_DEBUG=1 pnpm start
//
// The debug screen drives the native module with no server or sign-in.
const CAPTURE_DEBUG_ROOT = './modules/triage-capture/debug/app';

module.exports = ({ config }) => {
  if (process.env.TRIAGECAM_CAPTURE_DEBUG !== '1') return config;
  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      plugin === 'expo-router' ? ['expo-router', { root: CAPTURE_DEBUG_ROOT }] : plugin,
    ),
  };
};
