import { defineConfig } from "vite";

// 상대 경로 빌드: GitHub Pages(https://<id>.github.io/<repo>/)에서도 그대로 동작
export default defineConfig({
  base: "./",
  server: { port: 5173 },
});
