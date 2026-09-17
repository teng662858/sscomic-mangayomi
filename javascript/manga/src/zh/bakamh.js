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
    "version": "0.1.2",
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
var mirrorIndex = 0;

class DefaultExtension extends MProvider {
  /** 镜像列表：源设置里填的地址排在最前，其余按内置顺序跟在后面。 */
  get mirrors() {
    var configured = String(this.source.baseUrl || "").trim().replace(/\/+$/, "");
    var list = MIRRORS.slice();
    if (configured && list.indexOf(configured) === -1) list.unshift(configured);
    return list;
  }

  get base() {
    var list = this.mirrors;
    return list[mirrorIndex % list.length];
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

  /** 懒加载图片的真地址可能在 data-src / data-lazy-src / srcset 里 */
  imgSrc(el) {
    if (!el) return "";
    var keys = ["data-src", "data-lazy-src", "data-original", "src"];
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

  async getHtml(path) {
    var url = /^https?:\/\//i.test(path) ? path : this.base + this.pathOf(path);
    var res = await new Client().get(url, this.headers);
    var body = res && res.body ? String(res.body) : "";
    if (this.isCloudflareChallenge(body)) {
      // 自动换下一个域名，用户重试即可——比一直卡在同一个域名上强
      mirrorIndex = (mirrorIndex + 1) % this.mirrors.length;
      throw new Error("当前域名被 Cloudflare 拦住，已自动切换到 " + this.base + "，请重试。");
    }
    if (res && res.statusCode && res.statusCode >= 400) {
      throw new Error("请求失败（HTTP " + res.statusCode + "）：" + url);
    }
    return body;
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
    var doc = new Document(await this.getHtml(path));
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
    var doc = new Document(await this.getHtml(this.pathOf(url)));

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
    var html = await this.getHtml(this.pathOf(url));
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

    // 刻意不做「扫描整页图片」的兜底：那会把主题图标、广告图当成漫画页（真机上就是这样，翻出来是乱的）。
    // 解析不到就明确报错，比给出一堆错的图好。
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
