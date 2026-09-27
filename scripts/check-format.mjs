import { readFile, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const write = process.argv.includes("--write");
const roots = ["src", "test", "scripts", "docs"];
const files = ["README.md", "package.json", "tsconfig.json", "wrangler.toml", ".env.example", ".gitignore"];
for (const root of roots) await walk(root, files);
let changed = 0;
for (const file of files) {
  if (![".ts", ".js", ".mjs", ".json", ".md", ".toml", ".example", ".gitignore"].includes(extname(file)) && file !== ".gitignore") continue;
  const original = await readFile(file, "utf8");
  const formatted = `${original.split("\n").map((line) => line.replace(/[ \t]+$/u, "")).join("\n").replace(/\n*$/u, "")}\n`;
  if (original !== formatted) {
    changed++;
    if (write) await writeFile(file, formatted);
    else console.error(`Formatting differs: ${file}`);
  }
}
if (changed && !write) process.exitCode = 1;

async function walk(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, output);
    else output.push(path);
  }
}
