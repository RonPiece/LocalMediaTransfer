module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        root: ['./src'],
        alias: {
          '@': './src',
        },
        extensions: ['.ios.ts', '.ios.tsx', '.android.ts', '.android.tsx', '.ts', '.tsx', '.js', '.jsx', '.json'],
      }],
      'nativewind/babel',
    ],
  };
};
