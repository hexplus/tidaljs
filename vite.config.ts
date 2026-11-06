import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs, so the build works under /tidaljs/ on GitHub Pages
  // and from any other folder.
  base: "./",
  plugins: [],
});
