const path = require('path');

module.exports = {
  entry: './src/index.js', // Entry point for your React app
  output: {
    path: path.resolve(__dirname, 'public'), // Output to the 'public' folder
    filename: 'bundle.js', // Name of the bundled file
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/, // Transpile .js and .jsx files
        exclude: /node_modules/, // Exclude dependencies
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'], // Babel presets
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'], // Allow importing without specifying extensions
  },
  mode: 'development', // Use 'production' for production builds
};
