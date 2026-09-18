// 涩涩漫画（sscomic.top）— Mangayomi JavaScript 扩展
//
// 站点是定制版 Maccms（Mcpath.tpl = /template/wap/zq009/），所有页面服务端渲染，
// 没有站内 XHR 接口、没有加密签名、不需要登录，因此这里只做 HTML 解析。
//
// 路由（全部用真实页面实测过）：
//   /category/page/N                     书库（默认按热度，共 215 页）
//   /category/order/addtime/page/N       书库（按最新，共 215 页）
//   /category/list/{id}/page/N           分类书库（id 见 CATEGORY_OPTIONS）
//   /search?key={kw}                     搜索第 1 页
//   /search/{kw}/{N}                     搜索第 N 页
//   /comic/{slug}                        详情
//   /chapter/{id}                        阅读页（图片在 #comic-data 的 JSON 数组里）

// 头部键名一律带引号：官方所有 JS 源都这么写，App 若按 JSON 解析这段也不会出错。
const mangayomiSources = [
  {
    "name": "涩涩漫画",
    "lang": "zh",
    "baseUrl": "https://sscomic.top",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/teng662858/sscomic-tachimanga/refs/heads/main/icons/sscomic.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.6",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "manga/src/zh/sscomic.js",
  },
];

// 站点对空 UA 会直接返回 Cloudflare 托管质询，必须带浏览器 UA。
var BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// 书库/搜索/排行/推荐四处共用同一套卡片结构，所以只有一个解析函数。
var CARD_SELECTOR = ".ss-grid li.ss-card";

// /category/list/{id} 的分类 id，取自站点自身的分类页标题。
var CATEGORY_OPTIONS = [
  { name: "全部", value: "" },
  { name: "韩漫", value: "1" },
  { name: "3D", value: "6" },
  { name: "写真", value: "7" },
  { name: "同人志", value: "10" },
  { name: "单行本", value: "11" },
  { name: "杂志&短篇", value: "12" },
];

var ORDER_OPTIONS = [
  { name: "热门", value: "hits" },
  { name: "最新", value: "addtime" },
];

// 站点域名（内容相同）。被拦住时按顺序自动往后换。
var MIRRORS = [
  "https://sscomic.top",
  "https://tw.sscomic.top",
];

// 源设置（Mangayomi 的「源设置」页）里可以手动指定域名。
var SITE_PREF = "site_base_url";
var CUSTOM_SITE_PREF = "custom_site_url";
var AUTO_SWITCH_PREF = "auto_switch_mirror";
var NEWEST_FIRST_PREF = "newest_first";

// 下拉框显示用的名字：去掉协议，第一项标注「默认」。
var MIRROR_ENTRIES = MIRRORS.map(function (u, i) {
  return u.replace(/^https?:\/\//, "") + (i === 0 ? "（默认）" : "");
});


class DefaultExtension extends MProvider {
  /** 源设置里填的地址排最前，其余按内置顺序跟在后面。 */
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
    ];
  }

  /** 当前使用的域名：永远是用户选的那个，不会因为之前失败过就跑到别的域名上。 */
  get base() {
    return this.mirrors[0];
  }

  get headers() {
    return {
      "User-Agent": BROWSER_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: this.base + "/",
    };
  }

  getHeaders(url) {
    return this.headers;
  }

  // -------------------------------------------------------------------------
  // 取值与请求
  // -------------------------------------------------------------------------

  text(el) {
    return el ? String(el.text || "").trim() : "";
  }

  attr(el, name) {
    return el ? String(el.attr(name) || "").trim() : "";
  }

  /** `/comic/mimijiaoxuemimishouye` → `mimijiaoxuemimishouye` */
  slugFrom(href) {
    var m = /\/comic\/([^/?#]+)/i.exec(String(href || ""));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /** `/chapter/44820` → `44820` */
  chapterIdFrom(href) {
    var m = /\/chapter\/(\d+)/i.exec(String(href || ""));
    return m ? m[1] : "";
  }

  /** 详情/章节页里拿到的是相对路径，也兼容直接给绝对地址的情况。 */
  pathOf(url) {
    var raw = String(url || "").trim();
    if (/^https?:\/\//i.test(raw)) {
      return raw.replace(/^https?:\/\/[^/]+/i, "") || "/";
    }
    return raw ? (raw.charAt(0) === "/" ? raw : "/" + raw) : "/";
  }

  isCloudflareChallenge(html) {
    return (
      html.indexOf("_cf_chl_opt") !== -1 ||
      /<title>\s*Just a moment/i.test(html) ||
      /challenge-platform\/h\//.test(html)
    );
  }

  /** 列表页：卡片是 li.ss-card */
  hasCards(html) {
    return html.indexOf("ss-card") !== -1;
  }

  hasDetail(html) {
    return html.indexOf("ss-info-title") !== -1;
  }

  /** 阅读页：图片地址都在 script#comic-data 里 */
  hasPages(html) {
    return html.indexOf("comic-data") !== -1;
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
    if (lastError.indexOf("被 Cloudflare 拦住") !== -1) {
      throw new Error("站点被 Cloudflare 拦住：请在网页视图里打开站点过一次验证，返回后再重试。");
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
  // 列表页解析
  // -------------------------------------------------------------------------

  parseCards(doc) {
    var list = [];
    for (var el of doc.select(CARD_SELECTOR)) {
      var link = el.selectFirst("a.ss-card-link");
      var href = this.attr(link, "href");
      var id = this.slugFrom(href);
      var name = this.text(el.selectFirst(".ss-name")) || this.attr(link, "aria-label");
      if (!id || !name) continue;
      list.push({
        name: name,
        imageUrl: this.attr(el.selectFirst("figure.ss-thumb img"), "src"),
        link: href,
      });
    }
    return list;
  }

  /** `.ss-pager-info` 形如「第 1 / 215 页」；拿不到就退化为看有没有「下一页」。 */
  hasNextPage(doc, page, count) {
    if (count === 0) return false;
    var m = /\/\s*(\d+)\s*页/.exec(this.text(doc.selectFirst(".ss-pager-info")));
    if (m) return page < Number(m[1]);
    var labels = [];
    for (var a of doc.select(".ss-pager a")) labels.push(this.text(a));
    return labels.join("").indexOf("下一页") !== -1;
  }

  async listRequest(path, page) {
    var doc = new Document(await this.getHtml(path, "hasCards"));
    var list = this.parseCards(doc);
    return { list: list, hasNextPage: this.hasNextPage(doc, page, list.length) };
  }

  // -------------------------------------------------------------------------
  // 站点入口
  // -------------------------------------------------------------------------

  async getPopular(page) {
    return await this.listRequest("/category/page/" + page, page);
  }

  async getLatestUpdates(page) {
    return await this.listRequest("/category/order/addtime/page/" + page, page);
  }

  async search(query, page, filters) {
    var keyword = String(query || "").trim();

    if (keyword !== "") {
      var path =
        page <= 1
          ? "/search?key=" + encodeURIComponent(keyword)
          : "/search/" + encodeURIComponent(keyword) + "/" + page;
      return await this.listRequest(path, page);
    }

    // 空关键词时走筛选器：站点不支持「分类 + 排序」组合，分类优先。
    var order = "hits";
    var category = "";
    for (var filter of filters || []) {
      var values = filter["values"] || [];
      var state = filter["state"] || 0;
      var picked = values[state] ? String(values[state]["value"] || "") : "";
      if (filter["type"] === "order") order = picked || "hits";
      if (filter["type"] === "category") category = picked;
    }

    var listPath;
    if (category !== "") {
      listPath = "/category/list/" + category + "/page/" + page;
    } else if (order === "addtime") {
      listPath = "/category/order/addtime/page/" + page;
    } else {
      listPath = "/category/page/" + page;
    }
    return await this.listRequest(listPath, page);
  }

  // -------------------------------------------------------------------------
  // 详情
  // -------------------------------------------------------------------------

  async getDetail(url) {
    var doc = new Document(await this.getHtml(this.pathOf(url), "hasDetail"));

    var title = this.text(doc.selectFirst("h2.ss-info-title"));
    if (title === "") title = this.text(doc.selectFirst("title"));
    if (title === "") throw new Error("解析详情失败，页面结构与预期不符：" + url);

    var description =
      this.text(doc.selectFirst("#ss-desc p")) ||
      this.text(doc.selectFirst("section.ss-desc p"));

    // 章节列表在页面里是正序（第 1 话在前），默认反转成新章在前，与常见阅读器习惯一致。
    var episodes = [];
    for (var el of doc.select("#chapter-list a.ss-chapter-item")) {
      var link = this.attr(el, "href");
      if (!link) continue;
      var name = this.text(el.selectFirst(".name")) || this.text(el);
      var episode = { name: name, url: link };

      var dateText = this.text(el.selectFirst("time"));
      var timestamp = Date.parse(dateText);
      // MChapter.dateUpload 是 String?（不是数字）：必须是「字符串形式的毫秒时间戳」，
      // 传数字会让 App 在 MChapter.fromJson 里抛 type 'int' is not a subtype of type 'String?'。
      if (!isNaN(timestamp)) episode.dateUpload = String(timestamp);

      episodes.push(episode);
    }
    // 站点是正序（第 1 话在前）；按设置决定是否反转成新章在前
    if (this.prefOn(NEWEST_FIRST_PREF, true)) episodes.reverse();

    return {
      name: title,
      imageUrl: this.attr(doc.selectFirst(".ss-info-cover img"), "src"),
      description: description,
      genre: [],
      // 站点作者字段是恒为空的（详情页用 CSS fallback 显示站名），这里保持原样不猜。
      author: this.text(doc.selectFirst(".ss-info-meta .ss-author")),
      // 站点不提供连载状态，按规范取 5（unknown）。
      status: 5,
      episodes: episodes,
    };
  }

  // -------------------------------------------------------------------------
  // 章节图片
  // -------------------------------------------------------------------------

  async getPageList(url) {
    var doc = new Document(await this.getHtml(this.pathOf(url), "hasPages"));
    var raw = this.text(doc.selectFirst("#comic-data"));

    if (raw === "") throw new Error("章节页没有找到 #comic-data，页面结构可能已变更：" + url);

    var images = [];
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (var item of parsed) {
          if (typeof item === "string" && item.trim() !== "") images.push(item.trim());
        }
      }
    } catch (e) {
      // JSON 被截断时退化为正则兜底，避免整章直接失败。
      var matched = raw.match(/https?:\/\/[^"\s]+?\.(?:webp|jpg|jpeg|png|gif)/gi);
      if (matched) images = matched;
    }

    var result = [];
    for (var image of images) {
      result.push(/^https?:\/\//i.test(image) ? image : this.base + image);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 筛选器
  // -------------------------------------------------------------------------

  getFilterList() {
    var orders = [];
    for (var o of ORDER_OPTIONS) {
      orders.push({ type_name: "SelectOption", name: o.name, value: o.value });
    }
    var categories = [];
    for (var c of CATEGORY_OPTIONS) {
      categories.push({ type_name: "SelectOption", name: c.name, value: c.value });
    }
    return [
      { type: "order", name: "排序", type_name: "SelectFilter", values: orders },
      { type: "category", name: "分类", type_name: "SelectFilter", values: categories },
    ];
  }
}
