const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

// Enable R8 optimisation and optimised resource shrinking to reduce release size.
module.exports = function withR8Optimization(config) {
  config = withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /getDefaultProguardFile\((['"])proguard-android\.txt\1\)/g,
      'getDefaultProguardFile($1proguard-android-optimize.txt$1)',
    );
    return cfg;
  });

  return withGradleProperties(config, (cfg) => {
    const key = 'android.r8.optimizedResourceShrinking';
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === key),
    );
    cfg.modResults.push({ type: 'property', key, value: 'true' });
    return cfg;
  });
};
