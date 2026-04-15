module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly"
      }
    },
    rules: {
      semi: ["error", "always"],
      eqeqeq: ["error", "always"],
      curly: ["error", "all"]
    }
  },

  // 🌐 browser files
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly"
      }
    },
    rules: {
      "no-undef": "off"
    }
  }
];