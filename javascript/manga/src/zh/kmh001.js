// K漫画（kmh001.net）— Mangayomi JavaScript 扩展
//
// 站点是 Next.js（App Router）做的，服务端渲染 + RSC 流式数据，**没有对外 REST 接口**。
// 两个关键点：
//   1. 详情页的章节列表没有 href，章节 id 只存在于页面底部的 RSC 数据块里；
//   2. 阅读页的图片地址也不在 <img> 里，同样只在 RSC 数据块里，而且**按图源分组**
//      （先 FREEXCOMIC 的 N 张，再 NNHANMAN 的 N 张），只能取其中一个源，混着取顺序会乱。
//
// 路由（均已实测）：
//   /home                     首页列表（48 条，**无分页**，page 参数无效）
//   /search?key={关键词}       搜索（**无分页**；本站只索引中文标题，英文词搜不到）
//   /tag?value={标签}&page={N} 标签浏览（**唯一可翻页的浏览入口**）
//   /comic/{24位id}           详情
//   /chapter/{24位id}         阅读页
//
// 站点常年被墙（官方发布页自己写着"打不开可邮件索取新地址"），镜像：kmh001.com ~ kmh006.com。

const mangayomiSources = [
  {
    "name": "K漫画",
    "lang": "zh",
    "baseUrl": "https://kmh001.net",
    "apiUrl": "",
    "iconUrl": "https://kmh001.net/android-icon-192x192.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.3",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "manga/src/zh/kmh001.js",
  },
];

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// 图片默认取 FREEXCOMIC；该源缺失时退化为张数最多的那个源（见 getPageList）。
var PREFERRED_IMAGE_SOURCE = "FREEXCOMIC";

// 列表页的 HTML 里没有 <img>（站点是懒加载的），但封面地址能按固定规律算出来：
//   封面 = https://img.kmh.pics/ + base64url(标题 + "-cover") + .jpg
// 这个规律是在真实数据上往返验证过的（解码站点自己给的封面地址，再用标题重新编码，完全一致）。
// 极少数没有封面的作品会 404，阅读器会自己显示占位图。
var COVER_BASE = "https://img.kmh.pics/";
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 字符串 → UTF-8 字节（不依赖 btoa，QQJS 里不一定有） */
function utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

/** UTF-8 字符串 → base64url（无 = 填充，与站点一致） */
function base64url(str) {
  var bytes = utf8Bytes(str);
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = bytes[i + 1];
    var b2 = bytes[i + 2];
    out += B64_CHARS.charAt(b0 >> 2);
    out += B64_CHARS.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4));
    if (b1 === undefined) break;
    out += B64_CHARS.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6));
    if (b2 === undefined) break;
    out += B64_CHARS.charAt(b2 & 63);
  }
  return out;
}

function coverUrl(title) {
  var name = String(title || "").trim();
  if (name === "") return "";
  return COVER_BASE + base64url(name + "-cover") + ".jpg";
}

/** base64url → UTF-8 字符串（把页面里给的封面地址还原成标题用） */
function base64urlDecode(str) {
  var table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  var bytes = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < clean.length; i++) {
    var idx = table.indexOf(clean.charAt(i));
    if (idx < 0) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  var out = "";
  for (var j = 0; j < bytes.length; j++) {
    var b = bytes[j];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0 && j + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++j] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0 && j + 2 < bytes.length) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++j] & 0x3f) << 6) | (bytes[++j] & 0x3f));
    } else if (b >= 0xf0 && j + 3 < bytes.length) {
      var cp = ((b & 0x07) << 18) | ((bytes[++j] & 0x3f) << 12) | ((bytes[++j] & 0x3f) << 6) | (bytes[++j] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

/**
 * 列表页的 HTML 里其实带着真实封面地址（只是没有 <img>，藏在内嵌数据里）。
 * 文件名是 base64url("<标题>-cover")，反过来解码就能得到一张「标题 → 封面」表——
 * 比按标题硬拼准（个别作品的命名与标题对不上，硬拼会 404，就是"有几个显示不出来"的原因）。
 */
function coverMapFromHtml(html) {
  var map = {};
  var re = /https?:\/\/img\.kmh\.pics\/([A-Za-z0-9_-]+)\.jpg/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var name = base64urlDecode(m[1]);
    if (name.length < 7 || name.indexOf("-cover") !== name.length - 6) continue;
    var title = name.substring(0, name.length - 6);
    if (title && !map[title]) map[title] = m[0];
  }
  return map;
}

// 详情页/阅读页 RSC 数据块里的字段。
// 注意：章节对象的字段顺序不固定（有的 _id 后跟 subtitle，有的先跟 title），
// 所以先整体框出 `{"_id":"..."...}` 这个对象，再在对象内单独取字段。
var RE_CHAPTER_OBJ = /\{\\"_id\\":\\"([0-9a-f]{24})\\"[^{}]*\}/g;
var RE_SUBTITLE = /\\"subtitle\\":\\"([^\\]*)\\"/;
var RE_UPDATE_AT = /\\"updateAt\\":\\"([^\\"]*)\\"/;
var RE_IMAGE = /\\"sourceName\\":\\"([A-Za-z0-9_]+)\\",\\"url\\":\\"([^"\\]+)\\",\\"sortIndex\\":(\d+)/g;
var RE_CHAPTER_NAME = /\\"flex-1 text-center text-xl font-bold truncate\\",\\"children\\":\\"([^\\]*)\\"/;
var RE_PREV = /\\"preID\\":\\"([0-9a-f]{24})\\"/;
var RE_NEXT = /\\"nextID\\":\\"([0-9a-f]{24})\\"/;

// 站点标签（逐个实测过，都有作品；/tag 索引页是客户端渲染的，取不到，只能列在这）
var TAGS = [
  "熟女", "人妻", "年龄差距", "禁忌关系", "办公室", "有夫之妇", "巨乳", "妹妹",
  "继母", "后宫", "浪漫爱情", "戏剧", "剧情", "欲望", "已婚", "NTL",
  "不伦", "秘密", "女大生", "上班族",
];

// 站点域名（内容相同）。被拦住时按顺序自动往后换。
var MIRRORS = [
  "https://kmh001.net",
  "https://kmh001.com",
  "https://kmh002.com",
  "https://kmh003.com",
  "https://kmh004.com",
  "https://kmh005.com",
  "https://kmh006.com",
];

// 源设置（Mangayomi 的「源设置」页）里可以手动指定域名。
var SITE_PREF = "site_base_url";

// 下拉框显示用的名字：去掉协议，第一项标注「默认」。
var MIRROR_ENTRIES = MIRRORS.map(function (u, i) {
  return u.replace(/^https?:\/\//, "") + (i === 0 ? "（默认）" : "");
});

var mirrorIndex = 0;

class DefaultExtension extends MProvider {
  /** 源设置里填的地址排最前，其余按内置顺序跟在后面。 */
  get mirrors() {
    var configured = String(this.readSitePref() || this.source.baseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    var list = MIRRORS.slice();
    if (configured && list.indexOf(configured) === -1) list.unshift(configured);
    return list;
  }

  /** 源设置里选的站点地址。取不到（比如离线测试台里没有 SharedPreferences）就当没设置。 */
  readSitePref() {
    try {
      var saved = new SharedPreferences().get(SITE_PREF);
      return saved ? String(saved) : "";
    } catch (e) {
      return "";
    }
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
    ];
  }

  get base() {
    var list = this.mirrors;
    return list[mirrorIndex % list.length];
  }

  get headers() {
    return {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
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

  /** `/comic/6a3de4dc37f118c8d182095c` → `6a3de4dc37f118c8d182095c` */
  comicId(href) {
    var m = /\/comic\/([0-9a-f]{24})/i.exec(String(href || ""));
    return m ? m[1] : "";
  }

  chapterId(href) {
    var m = /\/chapter\/([0-9a-f]{24})/i.exec(String(href || ""));
    return m ? m[1] : "";
  }

  pathOf(url) {
    var raw = String(url || "").trim();
    if (/^https?:\/\//i.test(raw)) return raw.replace(/^https?:\/\/[^/]+/i, "") || "/";
    return raw ? (raw.charAt(0) === "/" ? raw : "/" + raw) : "/";
  }

  isCloudflareChallenge(html) {
    return html.indexOf("_cf_chl_opt") !== -1 || /<title>\s*Just a moment/i.test(html);
  }

  async getHtml(path) {
    var url = /^https?:\/\//i.test(path) ? path : this.base + this.pathOf(path);
    var res = await new Client().get(url, this.headers);
    var body = res && res.body ? String(res.body) : "";
    if (this.isCloudflareChallenge(body)) {
      mirrorIndex = (mirrorIndex + 1) % this.mirrors.length;
      throw new Error("当前域名被 Cloudflare 拦住，已自动切换到 " + this.base + "，请重试。");
    }
    if (res && res.statusCode && res.statusCode >= 400) {
      throw new Error("请求失败（HTTP " + res.statusCode + "）：" + url);
    }
    return body;
  }

  // -------------------------------------------------------------------------
  // 列表页
  // -------------------------------------------------------------------------

  /**
   * 卡片结构（首页/搜索/标签页通用）：一个 <a href="/comic/{id}"> 里放 h3 标题、h4 最新章节。
   * 卡片里没有 <img>（站点懒加载），封面按标题算（见 coverUrl 的说明）。
   */
  parseCards(doc, coverMap) {
    var list = [];
    var seen = {};
    for (var el of doc.select("a[href^='/comic/']")) {
      var href = this.attr(el, "href");
      var id = this.comicId(href);
      if (!id || seen[id]) continue;
      var name = this.text(el.selectFirst("h3"));
      if (!name) continue;
      seen[id] = true;
      // 优先用页面里给出的真实封面；没有对上再按标题推算（见 coverMapFromHtml）
      var cover = (coverMap && coverMap[name]) || coverUrl(name);
      list.push({ name: name, imageUrl: cover, link: "/comic/" + id });
    }
    return list;
  }

  /** 首页和搜索都没有分页；只有标签页能翻页（靠 ?page=N）。 */
  async listRequest(path, page, paged) {
    var html = await this.getHtml(path);
    var list = this.parseCards(new Document(html), coverMapFromHtml(html));
    var hasNextPage = false;
    if (paged && list.length > 0) {
      hasNextPage = html.indexOf("page=" + (page + 1)) !== -1;
    }
    return { list: list, hasNextPage: hasNextPage };
  }

  async getPopular(page) {
    // 站点没有"热门"榜，首页就是最新更新列表，且只有第 1 页。
    if (page > 1) return { list: [], hasNextPage: false };
    return await this.listRequest("/home", 1, false);
  }

  async getLatestUpdates(page) {
    if (page > 1) return { list: [], hasNextPage: false };
    return await this.listRequest("/home", 1, false);
  }

  async search(query, page, filters) {
    var keyword = String(query || "").trim();

    // 有关键词 → 搜索（本站只索引中文标题，英文词一定搜不到）
    if (keyword !== "") {
      if (page > 1) return { list: [], hasNextPage: false };
      return await this.listRequest("/search?key=" + encodeURIComponent(keyword), 1, false);
    }

    // 空关键词 → 看标签筛选；标签页是唯一能翻页的入口
    var tag = "";
    for (var filter of filters || []) {
      if (filter["type"] !== "tag") continue;
      var values = filter["values"] || [];
      var picked = values[filter["state"] || 0];
      tag = picked ? String(picked["value"] || "") : "";
    }
    if (tag !== "") {
      return await this.listRequest("/tag?value=" + encodeURIComponent(tag) + "&page=" + page, page, true);
    }

    if (page > 1) return { list: [], hasNextPage: false };
    return await this.listRequest("/home", 1, false);
  }

  // -------------------------------------------------------------------------
  // 详情
  // -------------------------------------------------------------------------

  async getDetail(url) {
    var html = await this.getHtml(this.pathOf(url));
    var doc = new Document(html);

    var title = this.text(doc.selectFirst("h1")) || this.text(doc.selectFirst("title"));
    if (title === "") throw new Error("解析详情失败，页面结构与预期不符：" + url);

    var cover = this.attr(doc.selectFirst(".swiper-slide img"), "src");

    // 作者写在节点文本里（"作者：XXX"），要去前缀；该字段可能为空
    var author = this.text(doc.selectFirst("span.truncate")).replace(/^作者[:：]\s*/, "");

    var description = this.text(doc.selectFirst("div.flex-1.line-clamp-3 p"));

    // 标签写成 "年龄差距 >"，去掉尾巴上的箭头
    var genre = [];
    for (var tagEl of doc.select("a[href^='/tag?value=']")) {
      var name = this.text(tagEl).replace(/\s*>\s*$/, "").trim();
      if (name) genre.push(name);
    }

    // 章节在 RSC 数据块里（HTML 里的章节行没有 href）
    var episodes = [];
    RE_CHAPTER_OBJ.lastIndex = 0;
    var m;
    while ((m = RE_CHAPTER_OBJ.exec(html)) !== null) {
      var obj = m[0];
      var sub = RE_SUBTITLE.exec(obj);
      if (!sub || !sub[1]) continue;
      var ep = { name: sub[1], url: "/chapter/" + m[1] };
      var up = RE_UPDATE_AT.exec(obj);
      if (up) {
        var ts = Date.parse(up[1]);
        // MChapter.dateUpload 是 String?，必须给字符串形式的毫秒时间戳
        if (!isNaN(ts)) ep.dateUpload = String(ts);
      }
      episodes.push(ep);
    }
    // 站点是正序（第 1 话在前），反转成新章在前
    episodes.reverse();

    return {
      name: title,
      imageUrl: cover,
      description: description,
      genre: genre,
      author: author,
      // 站点没有统一的连载状态字段
      status: 5,
      episodes: episodes,
    };
  }

  // -------------------------------------------------------------------------
  // 阅读页
  // -------------------------------------------------------------------------

  async getPageList(url) {
    var html = await this.getHtml(this.pathOf(url));

    // 图片按图源分组，先按源收齐再取一个源
    var grouped = {};
    var order = [];
    RE_IMAGE.lastIndex = 0;
    var m;
    while ((m = RE_IMAGE.exec(html)) !== null) {
      var source = m[1];
      if (!grouped[source]) {
        grouped[source] = [];
        order.push(source);
      }
      grouped[source].push({ url: m[2], index: Number(m[3]) });
    }

    var chosen = grouped[PREFERRED_IMAGE_SOURCE] ? PREFERRED_IMAGE_SOURCE : "";
    if (chosen === "") {
      // 首选源缺失时，取张数最多的那个，避免混源导致顺序错乱
      var best = "";
      for (var source of order) {
        if (best === "" || grouped[source].length > grouped[best].length) best = source;
      }
      chosen = best;
    }
    if (chosen === "") throw new Error("这个章节没有图片（站点对部分作品本身就没有图源）：" + url);

    var items = grouped[chosen];
    items.sort(function (a, b) { return a.index - b.index; });
    var result = [];
    for (var item of items) {
      result.push(/^https?:\/\//i.test(item.url) ? item.url : this.base + item.url);
    }
    return result;
  }

  /** 章节页的上一话/下一话（RSC 里的 preID / nextID），阅读器用不到，留着备用。 */
  async getNextChapterId(url) {
    var html = await this.getHtml(this.pathOf(url));
    var m = RE_NEXT.exec(html);
    return m ? m[1] : "";
  }

  async getPrevChapterId(url) {
    var html = await this.getHtml(this.pathOf(url));
    var m = RE_PREV.exec(html);
    return m ? m[1] : "";
  }

  // -------------------------------------------------------------------------
  // 筛选器
  // -------------------------------------------------------------------------

  getFilterList() {
    var values = [{ type_name: "SelectOption", name: "全部（首页）", value: "" }];
    for (var tag of TAGS) {
      values.push({ type_name: "SelectOption", name: tag, value: tag });
    }
    return [{ type: "tag", name: "标签", type_name: "SelectFilter", values: values }];
  }
}
