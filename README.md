# sscomic.top → Mangayomi 源（JavaScript）

Mangayomi **只能通过链接导入**：More → Settings → Browse 里填的是一份 `index.json` 的地址，
源码本身由索引里的 `sourceCodeUrl` 指向。所以这里除了源码，还准备了索引和填地址的小工具。

```text
mangayomi/
  index.json                             ← 仓库索引（要发布出去的那份）
  javascript/manga/src/zh/sscomic.js     ← 源本体
  tools/configure.mjs                    ← 把仓库地址写进索引，并打印导入链接
```

## 一、发布（一次性）

1. 在 GitHub 建一个仓库（名字随意，比如 `sscomic-mangayomi`）。
2. **保持这个目录结构推上去**——`index.json` 在根目录，源码在 `javascript/manga/src/zh/sscomic.js`：

   ```powershell
   cd mangayomi
   git init
   git add index.json javascript tools
   git commit -m "sscomic source"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

3. 把地址写进索引，并拿到导入链接：

   ```powershell
   # 默认用 raw.githubusercontent.com
   node tools\configure.mjs --owner <你的用户名> --repo <仓库名>

   # 国内 raw 经常连不上，推荐改用 GitHub Pages（在仓库 Settings → Pages 里把分支设成 main / root）
   node tools\configure.mjs --owner <你的用户名> --repo <仓库名> --host pages

   # 或者 jsDelivr 镜像
   node tools\configure.mjs --owner <你的用户名> --repo <仓库名> --host jsdelivr
   ```

   它会改掉 `index.json` 里的 `sourceCodeUrl`，并打印三种导入方式。改完记得再 commit + push 一次。

## 二、导入（手机上）

| 方式 | 怎么做 |
|---|---|
| 手动填地址 | More → **Settings → Browse**，粘贴 `.../index.json` 的完整地址 |
| 一键深链 | 手机上打开 `mangayomi://add-repo?repo_name=<仓库名>&repo_url=<仓库主页>&manga_url=<index.json 地址>`；Safari 里点不动就换成 `https://intradeus.github.io/http-protocol-redirector?r=<把上面整条 URL 编码后>` |
| LiveContainer 版本 | 把深链换成 `livecontainer://open-url?url=<上面 mangayomi:// 整条的 base64>` |

`tools/configure.mjs` 会把这三条直接打印出来，照抄即可。

> 有些版本在老界面里还能「扩展 → `+` → 手填字段 → 编辑代码」直接贴源码（`CONTRIBUTING-JS.md` 描述的就是这条路）。你的版本如果没有这个入口，就只能在上面三条链接方式里选。

## 三、改动后怎么让 App 看到更新

App 是靠 `version` 判断有没有新版本的，**两处都要改**：

- `javascript/manga/src/zh/sscomic.js` 里 `mangayomiSources[0].version`
- `index.json` 里同一条的 `version`

改完 push，App 里刷新仓库即可。

## 四、几个已知点

- **`hasCloudflare` 设为 `true`**：站点前面挂着 Cloudflare，且拦截是按 TLS 指纹判定的（curl/系统 TLS 能过，Node undici 403）。标记成 `true` 会让 App 走更保守的请求通道，稳一点但慢一点；如果你实测直接请求没问题，可以改成 `false` 提速。
- **站点换域名**：直接改 `sscomic.js` 里 `baseUrl`（或 App 里该源的设置项）+ `index.json` 里的 `baseUrl`，再 bump 版本。`tw.sscomic.top` 是繁体镜像；`ycomic.top` **不是**同一个站，别填。
- **作者字段为空是正常的**：该站详情页的作者位全站为空（页面用 CSS fallback 显示站名），所以源里不猜、留空。
- **内容分级**：`isNsfw: true` 已设置。
- **索引字段不能增删**：`tools/configure.mjs` 会拿官方仓库条目的字段集合做校验，多一个少一个都会报错并中止（App 是按固定字段解析的）。

## 五、本地验证

源码的解析逻辑有离线测试台（真实页面快照 + 32 项断言）：

```powershell
D:\Zcode\Breeze\.tools\node\node.exe ..\_tools\mangayomi-harness.cjs
```

它用 cheerio 模拟了 Mangayomi 的 `Client` / `Document` / `MProvider`，直接跑 `sscomic.js` 本身。
