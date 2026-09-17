# 中文漫画源（Mangayomi）

给 Mangayomi 用的 JavaScript 源。当前收录两个站：

| 源 | 站点 | 版本 | 说明 |
|---|---|---|---|
| 涩涩漫画 | sscomic.top | 0.1.1 | 定制 Maccms，纯 HTML 解析 |
| K漫画 | kmh001.net | 0.1.0 | Next.js + RSC，章节与图片都在内嵌数据里；站点常年被墙，镜像 kmh001.com ~ kmh006.com |

Mangayomi **只能通过链接导入**：More → Settings → Browse 里填的是一份 `index.json` 的地址，
源码本身由索引里的 `sourceCodeUrl` 指向。所以这里除了源码，还准备了索引和发布工具。

## 已经发布好了

仓库：<https://github.com/teng662858/sscomic-mangayomi>（公开，GitHub Pages 已开启）

App 里 **More → Settings → Browse** 粘贴这个地址即可：

```text
https://teng662858.github.io/sscomic-mangayomi/index.json
```

一键深链（手机上点开；Safari 不认自定义协议就用下面那条中转页）：

```text
mangayomi://add-repo?repo_name=sscomic-mangayomi&repo_url=https://github.com/teng662858/sscomic-mangayomi&manga_url=https://teng662858.github.io/sscomic-mangayomi/index.json

https://intradeus.github.io/http-protocol-redirector?r=mangayomi%3A%2F%2Fadd-repo%3Frepo_name%3Dsscomic-mangayomi%26repo_url%3Dhttps%3A%2F%2Fgithub.com%2Fteng662858%2Fsscomic-mangayomi%26manga_url%3Dhttps%3A%2F%2Fteng662858.github.io%2Fsscomic-mangayomi%2Findex.json
```

如果是用 LiveContainer 装的 Mangayomi，深链要换成：

```text
livecontainer://open-url?url=bWFuZ2F5b21pOi8vYWRkLXJlcG8/cmVwb19uYW1lPXNzY29taWMtbWFuZ2F5b21pJnJlcG9fdXJsPWh0dHBzOi8vZ2l0aHViLmNvbS90ZW5nNjYyODU4L3NzY29taWMtbWFuZ2F5b21pJm1hbmdhX3VybD1odHRwczovL3RlbmdlNjYyODU4LmdpdGh1Yi5pby9zc2NvbWljLW1hbmdheW9taS9pbmRleC5qc29u
```

**改了源码之后怎么更新**：改完 `javascript/manga/src/zh/sscomic.js`，把里面 `version` 加一位，
再跑 `powershell -ExecutionPolicy Bypass -File publish.ps1`。脚本自己会写索引、自检、提交、推送
（凭据已缓存，不会再弹登录窗），App 里刷新仓库即可看到新版本。

> 如果哪天 `github.io` 连不上（国内时通时不通），换一种托管再发一次：
> `publish.ps1 -Cdn raw`（raw.githubusercontent.com）或 `publish.ps1 -Cdn jsdelivr`。
> 换完 App 里的仓库地址也要跟着换成脚本打印出来的那条。

## 仓库结构

```text
mangayomi/
  index.json                             ← 仓库索引（App 导入的就是它的链接）
  javascript/manga/src/zh/sscomic.js     ← 源本体
  tools/configure.mjs                    ← 写仓库地址 + 打印导入链接
  publish.ps1                            ← 一键发布（写索引 → 自检 → 提交 → 推送）
  .gitattributes                         ← 固定 LF 换行
```

## 一、重新发布 / 换仓库

日常更新（改完源码后）：

```powershell
powershell -ExecutionPolicy Bypass -File publish.ps1
```

脚本会依次做：把仓库地址写回 `index.json` → 发布前自检（字段集合 + 索引与源码一致性）→
`git add/commit` → `git push`，最后把三种导入链接再打一遍。凭据由 Git Credential Manager 缓存，
第一次会弹一次 GitHub 登录窗，之后不再弹。

常用参数：

| 参数 | 作用 |
|---|---|
| `-Cdn pages\|raw\|jsdelivr` | 换托管方式（默认 pages，即 GitHub Pages） |
| `-Repo 名字` | 换仓库名（默认 `sscomic-mangayomi`） |
| `-Owner 用户名` | 换账号（默认从凭据里反查） |
| `-Token ghp_xxx` | 用 Personal Access Token（勾 `repo` 权限），完全不弹登录窗 |
| `-SkipPush` | 只做本地提交，不联网（用来试跑） |

> 这套依赖本机的便携版 git 和 node。没装 git 时先跑 `..\_tools\setup_git.ps1`（下载到 `..\_tools\git`，
> 不写注册表、不需要管理员权限）。如果哪天 GCM 弹窗出不来，就用 `-Token` 走 PAT。

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
- **⚠ Mangayomi 默认不显示 NSFW 源**：`isNsfw: true` 的扩展会被直接从列表里过滤掉，表现是「仓库加上了、扩展列表却是空的」。必须先在 **Settings → Browse → 拉到最下面 → NSFW (+18) sources** 打开开关，扩展才会出现。
- **加完仓库要点一下刷新**：添加仓库只是存下 URL，真正拉取扩展列表要按仓库管理页右上角的刷新按钮（或在扩展页下拉刷新）。
- **`MChapter` 的字段全是 `String?`，别传数字**（真机上踩过一次）：`dateUpload` 必须是**字符串形式的毫秒时间戳**，例如 `"1761494400000"`。传数字会让 App 在 `MChapter.fromJson` 抛 `type 'int' is not a subtype of type 'String?'`，表现是详情页 0 章 + 报错。
  官方模型定义：`lib/eval/model/m_chapter.dart`；App 消费方式：`lib/utils/fetch_interval.dart` 里 `int.tryParse(c.dateUpload ?? '')`。
  离线测试台里加了「章节对象里没有数字字段」这条回归断言，改代码后跑一次就能拦住这类问题。
- **`status` 取值**：`0=ongoing 1=completed 2=onHiatus 3=canceled 4=publishingFinished`，其余（含不传）都算 `unknown`。该站没有连载状态，所以填 `5`（→ unknown）。

## 五、本地验证

源码的解析逻辑有离线测试台（真实页面快照 + 32 项断言）：

```powershell
D:\Zcode\Breeze\.tools\node\node.exe ..\_tools\mangayomi-harness.cjs
```

它用 cheerio 模拟了 Mangayomi 的 `Client` / `Document` / `MProvider`，直接跑 `sscomic.js` 本身。
