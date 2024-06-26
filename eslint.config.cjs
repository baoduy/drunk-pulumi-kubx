module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json"],
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "require-await": "off",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/no-unsafe-member-access":"off",
    "@typescript-eslint/no-unsafe-assignment":"off",
    //"@typescript-eslint/no-unsafe-assignment":"off"
  },
  root: true,
  //ignores:['pulumi-test/*']
};
