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
    "iconUrl": "https://sscomic.top/sslogo.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.1",
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

class DefaultExtension extends MProvider {
  get base() {
    var raw = this.source.baseUrl || "https://sscomic.top";
    return String(raw).replace(/\/+$/, "");
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

  async getHtml(path) {
    var url = /^https?:\/\//i.test(path) ? path : this.base + this.pathOf(path);
    var res = await new Client().get(url, this.headers);
    var body = res && res.body ? String(res.body) : "";

    if (this.isCloudflareChallenge(body)) {
      throw new Error(
        "站点触发了 Cloudflare 人机校验，本次请求被拦截。请稍后重试；若持续失败，说明当前网络出口被站点风控。"
      );
    }
    if (res && res.statusCode && res.statusCode >= 400) {
      throw new Error("请求失败（HTTP " + res.statusCode + "）：" + url);
    }
    return body;
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
    var doc = new Document(await this.getHtml(path));
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
    var doc = new Document(await this.getHtml(this.pathOf(url)));

    var title = this.text(doc.selectFirst("h2.ss-info-title"));
    if (title === "") title = this.text(doc.selectFirst("title"));
    if (title === "") throw new Error("解析详情失败，页面结构与预期不符：" + url);

    var description =
      this.text(doc.selectFirst("#ss-desc p")) ||
      this.text(doc.selectFirst("section.ss-desc p"));

    // 章节列表在页面里是正序（第 1 话在前），反转成新章在前，与常见阅读器习惯一致。
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
    episodes.reverse();

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
    var doc = new Document(await this.getHtml(this.pathOf(url)));
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
