const path = require('path');

module.exports = {
  entry: ['./src/workerSt.ts', './src/workerMt.ts'],
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
  output: {
    path: path.join(process.cwd(), 'lib'),
    filename: 'worker.js',
  },
};
