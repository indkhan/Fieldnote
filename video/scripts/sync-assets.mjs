// Copies the font and logo geometry from the website, so the video can never drift from the product.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = resolve(root, "../docs");
mkdirSync(resolve(root, "public"), { recursive: true });
copyFileSync(resolve(docs, "assets/fonts/inter-latin-wght-normal.woff2"), resolve(root, "public/inter.woff2"));

const html = readFileSync(resolve(docs, "index.html"), "utf8");
const symbol = (id) => {
  const match = html.match(new RegExp(`<symbol id="${id}"[^>]*>(.*?)</symbol>`, "s"));
  if (!match) throw new Error(`Missing symbol ${id}`);
  return match[1];
};
const firstPath = (markup) => markup.match(/ d="([^"]+)"/)[1];
writeFileSync(
  resolve(root, "src/paths.json"),
  JSON.stringify({ claude: firstPath(symbol("i-claude")), codex: firstPath(symbol("i-codex")) }, null, 2),
);
console.log("Synced font and logo paths.");
