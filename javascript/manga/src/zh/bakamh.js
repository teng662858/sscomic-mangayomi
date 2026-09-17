// BAKA MH（bakamh.com）— Mangayomi JavaScript 扩展
//
// 站点是 WordPress + **Madara 主题**（漫画站标准模板），结构：
//   /manga/                                   作品库（可带 orderby/page 参数）
//   /?s={关键词}&post_type=wp-manga            搜索
//   /manga/{slug}/                            详情
//   /manga/{slug}/{章节}/                      阅读页
//
// 注意两点：
//   1. 站点开着 Cloudflare 托管质询，普通 HTTP 客户端（curl 等）一律 403，
//      所以订阅里把 hasCloudflare 设为 true，走 App 的 WebView/校验通道；
//   2. Madara 的图片与章节都是懒加载，真地址在 data-src / 自定义属性里，
//      下面是按 Madara 标准结构 + 多套兜底写的。
//
// 站点内容为成人向。

const mangayomiSources = [
  {
    "name": "BAKA MH",
    "lang": "zh",
    "baseUrl": "https://bakamh.com",
    "apiUrl": "",
    "iconUrl": "https://bakamh.com/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.6",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "manga/src/zh/bakamh.js",
  },
];

var UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

// 站点域名，官方发布页 https://bakamh.app 会实时更新（当前这 5 个）。
var MIRRORS = [
  "https://bakamh.com",
  "https://bakamh.ru",
  "https://baka1.cfd",
  "https://baka2.cfd",
  "https://baka3.cfd",
];

// 当前使用的域名下标；被 Cloudflare 拦住就往后换（进程内有效）
// 源设置（Mangayomi 的「源设置」页）里可以手动指定域名。
var SITE_PREF = "site_base_url";
var CUSTOM_SITE_PREF = "custom_site_url";
var AUTO_SWITCH_PREF = "auto_switch_mirror";
var NEWEST_FIRST_PREF = "newest_first";
var SCAN_FALLBACK_PREF = "scan_all_images";

// 下拉框显示用的名字：去掉协议，第一项标注「默认」。
var MIRROR_ENTRIES = MIRRORS.map(function (u, i) {
  return u.replace(/^https?:\/\//, "") + (i === 0 ? "（默认）" : "");
});


class DefaultExtension extends MProvider {
  /** 镜像列表：源设置里填的地址排在最前，其余按内置顺序跟在后面。 */
  get mirrors() {
    // 填了「自定义域名」就只用它：站点换域名很频繁，下拉列表来不及更新时靠这一项救急
    var custom = this.readCustomSite();
    if (custom) return [custom];
    var configured = String(this.readSitePref() || this.source.baseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    var list = MIRRORS.slice();
    if (configured && list.indexOf(configured) === -1) list.unshift(configured);
    return list;
  }

  /** 读源设置里的一个值。取不到（离线测试台里没有 SharedPreferences）就返回默认值。 */
  pref(key, fallback) {
    try {
      var saved = new SharedPreferences().get(key);
      if (saved === undefined || saved === null || saved === "") return fallback;
      return String(saved);
    } catch (e) {
      return fallback;
    }
  }

  /** 开关类设置：listPreference 存的是 "1"/"0"，也兼容 "true"/"false"。 */
  prefOn(key, fallback) {
    var value = this.pref(key, fallback ? "1" : "0").toLowerCase();
    return value === "1" || value === "true";
  }

  /** 源设置里选的站点地址（下拉里的那个）。 */
  readSitePref() {
    return this.pref(SITE_PREF, "");
  }

  /** 「自定义域名」：留空表示用下拉里的域名；填了会自动补 https://、去掉结尾斜杠。 */
  readCustomSite() {
    var raw = this.pref(CUSTOM_SITE_PREF, "").trim();
    if (raw === "") return "";
    return (/^https?:\/\//i.test(raw) ? raw : "https://" + raw).replace(/\/+$/, "");
  }

  /** Mangayomi 的「源设置」入口：手选一个能打开的域名。 */
  getSourcePreferences() {
    return [
      {
        key: SITE_PREF,
        listPreference: {
          title: "站点地址",
          summary: "打不开就换一个；解析不到内容时也会自动顺延下一个",
          valueIndex: 0,
          entries: MIRROR_ENTRIES,
          entryValues: MIRRORS,
        },
      },
      {
        key: CUSTOM_SITE_PREF,
        editTextPreference: {
          title: "自定义域名",
          summary: "留空则用上面的站点地址；填了以它为准（只填域名也行，会自动补 https://）",
          value: "",
          dialogTitle: "自定义域名",
          dialogMessage: "",
        },
      },
      {
        key: AUTO_SWITCH_PREF,
        listPreference: {
          title: "域名自动切换",
          summary: "拿不到内容时自动换下一个域名；关掉则固定用当前域名",
          valueIndex: 0,
          entries: ["开", "关"],
          entryValues: ["1", "0"],
        },
      },
      {
        key: NEWEST_FIRST_PREF,
        listPreference: {
          title: "新章在前",
          summary: "章节列表把最新章节排在最前面",
          valueIndex: 0,
          entries: ["开", "关"],
          entryValues: ["1", "0"],
        },
      },
      {
        key: SCAN_FALLBACK_PREF,
        listPreference: {
          title: "兜底扫描整页图片",
          summary: "解析不到图片时改扫页面里所有图片；可能把图标、广告当成漫画页，默认关",
          valueIndex: 1,
          entries: ["开", "关"],
          entryValues: ["1", "0"],
        },
      },
    ];
  }

  /** 当前使用的域名：永远是用户选的那个，不会因为之前失败过就跑到别的域名上。 */
  get base() {
    return this.mirrors[0];
  }

  get headers() {
    return {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: this.base + "/",
    };
  }

  getHeaders(url) {
    return this.headers;
  }

  // -------------------------------------------------------------------------
  // 基础
  // -------------------------------------------------------------------------

  text(el) {
    return el ? String(el.text || "").trim() : "";
  }

  attr(el, name) {
    return el ? String(el.attr(name) || "").trim() : "";
  }

  /**
   * 懒加载图片的真地址可能在 data-manga-src / data-src / srcset 里。
   *
   * `data-manga-src` 是这个站在用的自定义属性：阅读页的 img 上只有它，真 src 由站点自己的
   * 脚本补（`img.wp-manga-chapter-img[data-manga-src]` → `src`）。源里不跑页面脚本，
   * 少了这一项就会一张图都取不到。
   */
  imgSrc(el) {
    if (!el) return "";
    var keys = ["data-manga-src", "data-src", "data-lazy-src", "data-original", "data-cfsrc", "src"];
    for (var k of keys) {
      var v = this.attr(el, k);
      if (v && !/^data:/.test(v)) return v;
    }
    var srcset = this.attr(el, "srcset") || this.attr(el, "data-srcset");
    if (srcset) {
      var first = srcset.split(",")[0].trim().split(" ")[0];
      if (first) return first;
    }
    return "";
  }

  pathOf(url) {
    var raw = String(url || "").trim();
    if (/^https?:\/\//i.test(raw)) return raw.replace(/^https?:\/\/[^/]+/i, "") || "/";
    return raw ? (raw.charAt(0) === "/" ? raw : "/" + raw) : "/";
  }

  absolute(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return this.base + (raw.charAt(0) === "/" ? raw : "/" + raw);
  }

  isCloudflareChallenge(html) {
    return html.indexOf("_cf_chl_opt") !== -1 || /<title>\s*Just a moment/i.test(html);
  }

  /** 列表页：Madara 的作品链接都带 /manga/ */
  hasCards(html) {
    return html.indexOf("/manga/") !== -1;
  }

  hasDetail(html) {
    return html.indexOf("post-title") !== -1 || html.indexOf("<h1") !== -1;
  }

  /** 阅读页：Madara 的图片在 .reading-content 里 */
  hasPages(html) {
    return html.indexOf("reading-content") !== -1;
  }

  /**
   * 取页面。被 Cloudflare 质询、HTTP 报错、或者拿到的东西按 usable 判断根本没法解析时，
   * 就换下一个域名把同一个地址再取一次，所有域名都试完才抛错——不用用户手动点重试。
   */
  async getHtml(path, check) {
    var lastError = "";
    var mirrors = this.mirrors;
    // 关掉「域名自动切换」时只试一次，固定在当前域名上
    var maxAttempts = this.prefOn(AUTO_SWITCH_PREF, true) ? mirrors.length : 1;
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      // 顺延只发生在本次取页面内部：attempt 是局部序号，不写回任何全局状态
      var url = mirrors[attempt % mirrors.length] + this.pathOf(path);
      var res = await new Client().get(url, this.headers);
      var body = res && res.body ? String(res.body) : "";
      var blocked = this.isCloudflareChallenge(body);
      var failed = res && res.statusCode && res.statusCode >= 400;
      if (!blocked && !failed && (!check || this[check](body))) return body;
      lastError = blocked ? "被 Cloudflare 拦住" : failed ? "HTTP " + res.statusCode : "这一页解析不出内容";
    }
    throw new Error(
      "试过 " + maxAttempts + " 个域名都拿不到内容（最后：" + lastError + "）。可在「源设置 → 站点地址」里换一个域名，或稍后重试。",
    );
  }

  /** 相对路径或别的域名下的地址，一律落到用户选定的域名上（用于不在重试循环里的调用）。 */
  urlFor(path) {
    return this.base + this.pathOf(path);
  }

  // -------------------------------------------------------------------------
  // 列表（Madara 的卡片：.page-item-detail / .c-tabs-item__content）
  // -------------------------------------------------------------------------

  parseCards(doc) {
    var list = [];
    var seen = {};
    var cards = doc.select(".page-item-detail, .c-tabs-item__content, .manga__item, .row.c-tabs-item__content");
    if (cards.length === 0) cards = doc.select("div.item-summary, article");
    for (var el of cards) {
      var linkEl = el.selectFirst("h3 a, h4 a, .post-title a, a[href*='/manga/']");
      var href = this.attr(linkEl, "href");
      if (!href || href.indexOf("/manga/") === -1) continue;
      var name = this.text(el.selectFirst("h3, h4, .post-title"));
      if (!name) name = this.text(linkEl);
      if (!name) continue;
      var key = this.pathOf(href).replace(/\/+$/, "");
      if (seen[key]) continue;
      seen[key] = true;
      list.push({
        name: name,
        imageUrl: this.absolute(this.imgSrc(el.selectFirst("img"))),
        link: this.pathOf(href),
      });
    }
    return list;
  }

  /** Madara 分页器：.wp-pagenavi / nav.navigation-ajax 里的 next page 链接 */
  hasNextPage(doc) {
    var next = doc.selectFirst("a.nextpostslink, link[rel=next], a[rel=next]");
    if (next && this.attr(next, "href")) return true;
    var nav = this.text(doc.selectFirst(".wp-pagenavi, .navigation-ajax"));
    return /Next|下一页|»/.test(nav);
  }

  async listRequest(path) {
    var doc = new Document(await this.getHtml(path, "hasCards"));
    var list = this.parseCards(doc);
    return { list: list, hasNextPage: this.hasNextPage(doc) };
  }

  async getPopular(page) {
    // Madara 的作品库，按浏览量排序
    return await this.listRequest("/manga/page/" + page + "/?m_orderby=views");
  }

  async getLatestUpdates(page) {
    return await this.listRequest("/manga/page/" + page + "/?m_orderby=latest");
  }

  async search(query, page, filters) {
    var keyword = String(query || "").trim();
    if (keyword === "") return await this.listRequest("/manga/page/" + page + "/?m_orderby=latest");
    return await this.listRequest("/page/" + page + "/?s=" + encodeURIComponent(keyword) + "&post_type=wp-manga");
  }

  // -------------------------------------------------------------------------
  // 详情
  // -------------------------------------------------------------------------

  async getDetail(url) {
    var doc = new Document(await this.getHtml(this.pathOf(url), "hasDetail"));

    var title = this.text(doc.selectFirst(".post-title h1")) || this.text(doc.selectFirst("h1"));
    if (title === "") title = this.text(doc.selectFirst("title"));

    var description =
      this.text(doc.selectFirst(".description-summary p")) ||
      this.text(doc.selectFirst(".summary__content p")) ||
      this.text(doc.selectFirst(".summary__content"));

    var author = this.text(doc.selectFirst(".author-content a")) || this.text(doc.selectFirst(".author-content"));

    var genre = [];
    for (var g of doc.select(".genres-content a")) {
      var name = this.text(g);
      if (name) genre.push(name);
    }

    // 连载状态：Madara 的 .post-status .summary-content（"连载中"/"已完结"）
    var statusText = this.text(doc.selectFirst(".post-status .summary-content"));
    var status = 5;
    if (/已完结|完結|Completed/i.test(statusText)) status = 1;
    else if (/连载中|連載中|Ongoing/i.test(statusText)) status = 0;

    // 章节：Madara 标准是 li.wp-manga-chapter a；
    // bakamh 改过模板，章节链接放在自定义属性里，所以按「值以本漫画地址开头」来判定——
    // 这样导航（首页/漫画列表）、标签、登录提示和评论锚点都会被自然排除。
    var episodes = [];
    var seen = {};
    var mangaPath = this.pathOf(url).replace(/\/+$/, "/");
    var lowerMangaPath = mangaPath.toLowerCase();
    var chapterEls = doc.select("li.wp-manga-chapter a, .chapter-loveYou a, li:not(.menu-item) a");
    for (var el of chapterEls) {
      var link = this.attr(el, "storage-chapter-url");
      if (!link) {
        // 元素上第一个「值以本漫画地址开头」的属性就是章节链接
        for (var key of ["href", "data-url", "onclick"]) {
          var value = this.attr(el, key);
          if (!value) continue;
          var lower = value.toLowerCase();
          if (lower.indexOf(lowerMangaPath) === 0 && lower !== lowerMangaPath && lower.indexOf(lowerMangaPath + "#comment") !== 0) {
            link = value;
            break;
          }
        }
      }
      if (!link) continue;
      var chapterPath = this.pathOf(link);
      if (!chapterPath || seen[chapterPath]) continue;
      var name = this.text(el);
      if (!name) continue;
      seen[chapterPath] = true;
      episodes.push({ name: name, url: chapterPath });
    }

    // 站点给的是新章在前；关掉「新章在前」就反过来
    if (!this.prefOn(NEWEST_FIRST_PREF, true)) episodes.reverse();

    return {
      name: title,
      imageUrl: this.absolute(this.imgSrc(doc.selectFirst(".summary_image img"))),
      description: description,
      genre: genre,
      author: author,
      status: status,
      episodes: episodes,
    };
  }

  // -------------------------------------------------------------------------
  // 阅读页
  // -------------------------------------------------------------------------

  async getPageList(url) {
    var html = await this.getHtml(this.pathOf(url), "hasPages");
    var doc = new Document(html);
    var images = [];

    // 1) Madara 标准：.reading-content 里的图片（真地址多在 data-src）
    for (var img of doc.select(".reading-content img, .page-break img, img.wp-manga-chapter-img")) {
      var src = this.imgSrc(img);
      if (src) images.push(src);
    }

    // 2) 有些站把图片列表塞在 JS 变量里
    if (images.length === 0) {
      var matched = /(?:chapter_preloaded_images|chapterImages|images)\s*=\s*(\[[\s\S]*?\])/.exec(html);
      if (matched) {
        try {
          var parsed = JSON.parse(matched[1].replace(/\\\//g, "/"));
          if (Array.isArray(parsed)) {
            for (var item of parsed) {
              var u = typeof item === "string" ? item : (item && item.url ? item.url : "");
              if (u) images.push(u);
            }
          }
        } catch (e) {
          // 解析不了就走下面的正则兜底
        }
      }
    }

    // 默认不做「扫描整页图片」的兜底：那会把主题图标、广告图当成漫画页。
    // 想让它在解析不到时硬扫，可以在「源设置 → 兜底扫描整页图片」里打开。
    if (images.length === 0 && this.prefOn(SCAN_FALLBACK_PREF, false)) {
      for (var anyImg of doc.select("img")) {
        var anySrc = this.imgSrc(anyImg);
        if (anySrc) images.push(anySrc);
      }
    }
    var out = [];
    var seen = {};
    for (var u of images) {
      var abs = this.absolute(u);
      if (!abs || seen[abs]) continue;
      if (/loading|placeholder|logo|avatar|favicon|blank\./i.test(abs)) continue;
      seen[abs] = true;
      out.push(abs);
    }
    if (out.length === 0) {
      throw new Error("这一章没解析出图片：可能是站点结构变更，或这一页还没通过 Cloudflare 校验。请先确认网页版能正常看图。");
    }
    return out;
  }

  getFilterList() {
    return [];
  }
}
