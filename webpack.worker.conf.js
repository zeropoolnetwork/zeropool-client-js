// Currently not used
const path = require('path');

module.exports = {
  entry: {
    workerSt: './src/workerSt.ts',
    workerMt: './src/workerMt.ts',
  },
  output: {
    path: path.join(process.cwd(), 'lib'),
    filename: '[name].js',
    assetModuleFilename: '[name][ext]',
    publicPath: './',
  },
  target: 'webworker',
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.(ts)$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
};
