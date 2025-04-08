require("esbuild").build({
  bundle: true,
  entryPoints: [
    "src/app.ts"
  ],
  outfile: "./dist/bundle.js",
  packages: "external",
  platform: "node",
  sourcemap: true,
});
