import json from 'rollup-plugin-json'

export default {
  entry: 'dist/flash-store.js',
  dest: 'bundles/flash-store.es6.umd.js',
  sourceMap: true,
  format: 'umd',
  moduleName: 'window',
  banner: '/* flash-store version ' + require('./package.json').version + ' */',
  footer: '/* https://github.com/zixia */',
  plugins: [
    json({
      // All JSON files will be parsed by default,
      // but you can also specifically include/exclude files
      // include: 'node_modules/**',  // Default: undefined
      // exclude: [ 'node_modules/foo/**', 'node_modules/bar/**' ],  // Default: undefined
	    preferConst: true, // Default: false
    })
  ]
}
