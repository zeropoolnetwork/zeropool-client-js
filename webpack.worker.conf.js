const path = require('path');

module.exports = {
  entry: {
    workerSt: './src/workerSt.ts',
    workerMt: './src/workerMt.ts',
  },
  output: {
    path: path.join(process.cwd(), 'lib'),
    filename: '[name].js'
  },
  target: 'webworker',
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      // {
      //   test: /\.wasm?$/,
      //   type: 'asset/resource',
      // }
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
};
