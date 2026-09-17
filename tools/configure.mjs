#!/usr/bin/env node
/**
 * 把仓库地址写进 index.json，并输出各种「导入链接」。
 *
 * Mangayomi 只能通过链接导入：More → Settings → Browse 里填一份 index.json 的地址，
 * 源码本身由索引里的 sourceCodeUrl 指向。所以推仓库前要先把地址填对。
 *
 * 用法：
 *   node tools/configure.mjs --owner 你的GitHub名 --repo 仓库名
 *   node tools/configure.mjs --owner x --repo y --host pages      # 用 GitHub Pages（国内更稳）
 *   node tools/configure.mjs --owner x --repo y --dry-run         # 只看输出，不改文件
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(HERE, "..");
const INDEX_PATH = path.join(REPO_DIR, "index.json");
const SOURCE_REL = "javascript/manga/src/zh/sscomic.js";

function parseArgs(argv) {
  const out = { branch: "main", host: "raw", name: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.owner || !args.repo) {
  console.error("用法：node tools/configure.mjs --owner <GitHub 用户名> --repo <仓库名> [--branch main] [--host raw|pages|jsdelivr] [--dry-run]");
  process.exit(1);
}

// 三种托管方式，按「国内可达性」从稳到不稳：
//   pages     GitHub Pages，自己仓库直接出，不依赖第三方 CDN（推荐）
//   jsdelivr jsDelivr 的 GitHub 镜像
//   raw       raw.githubusercontent.com（最通用，但国内经常连不上）
const bases = {
  raw: `https://raw.githubusercontent.com/${args.owner}/${args.repo}/refs/heads/${args.branch}`,
  pages: `https://${args.owner.toLowerCase()}.github.io/${args.repo}`,
  jsdelivr: `https://cdn.jsdelivr.net/gh/${args.owner}/${args.repo}@${args.branch}`,
};
const base = bases[args.host];
if (!base) {
  console.error(`未知的 --host：${args.host}（可选 ${Object.keys(bases).join(" / ")}）`);
  process.exit(1);
}

const indexUrl = `${base}/index.json`;
const sourceUrl = `${base}/${SOURCE_REL}`;

// 源码文件在仓库里的位置必须是 index.json 里 sourceCodeUrl 指向的相对路径。
const sourceFile = path.join(REPO_DIR, SOURCE_REL);
if (!fs.existsSync(sourceFile)) {
  console.error(`找不到源码文件：${sourceFile}`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
if (!Array.isArray(index) || index.length === 0) {
  console.error("index.json 应该是一个非空数组");
  process.exit(1);
}
index[0].sourceCodeUrl = sourceUrl;

// 字段集合要跟官方仓库保持一致，多一个少一个都可能让 App 解析失败。
const official = [
  "name", "id", "baseUrl", "lang", "typeSource", "iconUrl", "dateFormat", "dateFormatLocale",
  "isNsfw", "hasCloudflare", "sourceCodeUrl", "apiUrl", "version", "isManga", "itemType",
  "isFullData", "appMinVerReq", "additionalParams", "sourceCodeLanguage", "notes",
];
const mine = Object.keys(index[0]);
const missing = official.filter((k) => !mine.includes(k));
const extra = mine.filter((k) => !official.includes(k));
if (missing.length || extra.length) {
  console.error(`字段与官方不一致：缺少 [${missing.join(", ")}]，多出 [${extra.join(", ")}]`);
  process.exit(1);
}
if (index[0].sourceCodeLanguage !== 1) {
  console.error("JavaScript 源的 sourceCodeLanguage 必须是 1（0 是 Dart）");
  process.exit(1);
}

if (!args.dryRun) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

const repoPage = `https://github.com/${args.owner}/${args.repo}`;
// 深链里的取值保持原样不转义 —— 这是社区公开仓库里已验证可用的写法
// （取值里不含 & ，所以不会把参数切断）。
const repoName = args.name || args.repo;
const deepLink = `mangayomi://add-repo?repo_name=${repoName}&repo_url=${repoPage}&manga_url=${indexUrl}`;
const viaRedirector = `https://intradeus.github.io/http-protocol-redirector?r=${encodeURIComponent(deepLink)}`;
const liveContainer = `livecontainer://open-url?url=${Buffer.from(deepLink, "utf8").toString("base64")}`;

console.log(`托管方式：${args.host}`);
console.log(`源码地址：${sourceUrl}`);
console.log("");
console.log("① App 内手动添加（More → Settings → Browse，粘贴这个）：");
console.log(`   ${indexUrl}`);
console.log("");
console.log("② 一键深链（在手机上点开；Safari 不行就改用下面那个中转页）：");
console.log(`   ${deepLink}`);
console.log(`   ${viaRedirector}`);
console.log("");
console.log("③ 用 LiveContainer 装的版本，Deep link 换成：");
console.log(`   ${liveContainer}`);
if (!args.dryRun) {
  console.log("");
  console.log(`已更新 ${INDEX_PATH}`);
} else {
  console.log("");
  console.log("（--dry-run：未写入文件）");
}
