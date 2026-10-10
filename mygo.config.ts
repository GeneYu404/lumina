import { defineConfig } from "mygo-cli";

/**
 * Configuration for the Go + MyGo shell.
 *
 * MyGo 自己没有窗口配置文件 —— 窗口在 `main.go` 里用 `mygo.NewWindow` 创建，
 * 这里只管打包：名字、图标、构建命令、文件关联。
 */
export default defineConfig({
  name: "Lumina",
  identifier: "app.lumina.viewer",
  version: "1.0.0",
  // resources/ is copied into the packaged app verbatim, which is where the
  // ffmpeg sidecar and its license ride along with the executable.
  icon: "resources/icon.png",

  // The frontend is the existing Vite app in src/, unchanged except for its
  // two bridge modules.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",

  // What the app opens when the file manager hands it a document: the same
  // two buckets the Go side registers (see internal/winos).
  fileAssociations: [
    {
      ext: ["jpg", "jpeg", "jfif", "png", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff"],
      name: "Lumina.Image",
      mimeType: "image/*",
      role: "Viewer",
    },
    {
      ext: ["mp4", "m4v", "mov", "webm", "mkv"],
      name: "Lumina.Video",
      mimeType: "video/*",
      role: "Viewer",
    },
  ],
});
