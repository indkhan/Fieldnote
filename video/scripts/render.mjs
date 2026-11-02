// Renders the finished social videos. Pass --preview for a fast low-resolution draft and contact sheets.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(root, "out");
mkdirSync(out, { recursive: true });
const cli = resolve(root, "node_modules/@remotion/cli/remotion-cli.js");
const ffmpeg = resolve(root, "node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe");
const run = (exe, args) => execFileSync(exe, args, { cwd: root, stdio: "inherit" });
const preview = process.argv.includes("--preview");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);

const versions = [
  ["Fieldnote-Landscape", "Fieldnote-16x9"],
  ["Fieldnote-Square", "Fieldnote-1x1"],
].filter(([id]) => !only || id.includes(only));

for (const [id, name] of versions) {
  if (preview) {
    const draft = resolve(out, `${name}-draft.mp4`);
    run(process.execPath, [cli, "render", id, draft, "--scale=0.4", "--crf=30", "--concurrency=6", "--log=error"]);
    run("python", [resolve(root, "scripts/sheet.py"), draft, resolve(out, `${name}-sheet`)]);
    continue;
  }
  const master = resolve(out, `${name}-master.mp4`);
  run(process.execPath, [cli, "render", id, master, "--crf=16", "--concurrency=6", "--audio-bitrate=320k", "--pixel-format=yuv420p", "--log=error"]);
  run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", master, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", resolve(out, `${name}.mp4`)]);
  rmSync(master);
  console.log(`Finished ${name}.mp4`);
}
