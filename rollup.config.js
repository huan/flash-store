export default {
  entry: 'dist/flash-store.js',
  dest: 'bundles/flash-store.es6.umd.js',
  sourceMap: true,
  format: 'umd',
  moduleName: 'window',
  banner: '/* flash-store version ' + require('./package.json').version + ' */',
  footer: '/* https://github.com/zixia */'
}
