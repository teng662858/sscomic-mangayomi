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
    "iconUrl": "https://raw.githubusercontent.com/teng662858/sscomic-tachimanga/refs/heads/main/icons/kmh001.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.9",
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

/**
 * 从搜索结果里读某部作品的连载状态。
 *
 * 详情页整页都没有「连载」二字（状态是客户端渲染的），但搜索结果卡片上写着
 * 「连载状态：连载中 / 已完结」，所以详情多花一次搜索请求把状态补回来。
 * 卡片里按「链接 → 标题 → 话数 → 更新时间 → 连载状态」排列，窗口截到下一张卡片的
 * 链接为止，免得读到别人的状态。取不到就返回 5（Mangayomi 的 unknown）。
 */
function statusFromSearchHtml(html, id) {
  var at = html.indexOf("/comic/" + id);
  if (at < 0) return 5;
  var next = html.indexOf("/comic/", at + 1);
  var card = html.slice(at, next > at ? next : at + 4000);
  if (card.indexOf("已完结") !== -1) return 1; // completed
  if (card.indexOf("连载中") !== -1) return 0; // ongoing
  return 5; // unknown
}

/**
 * 从响应头里挑出会话 cookie（只要 name=value 那一段，丢掉 Path/HttpOnly 这些属性）。
 *
 * Mangayomi 返回的 headers 键名是小写的；多个 Set-Cookie 会被合并成一个逗号分隔的串，
 * 所以先按逗号切、再各自截到分号为止。
 */
function cookieFromHeaders(headers) {
  if (!headers) return "";
  var raw = headers["set-cookie"] || headers["Set-Cookie"] || "";
  if (!raw) return "";
  var out = [];
  for (var part of String(raw).split(",")) {
    var pair = part.split(";")[0].trim();
    if (!pair || pair.indexOf("=") <= 0) continue;
    // 只留 name=value 形式（属性片段会被上面的分号截掉）
    if (!/^[^=\s]+=[^=\s]*$/.test(pair)) continue;
    if (out.indexOf(pair) === -1) out.push(pair);
  }
  return out.join("; ");
}

// 详情页/阅读页 RSC 数据块里的字段。// 注意：章节对象的字段顺序不固定（有的 _id 后跟 subtitle，有的先跟 title），
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
var CUSTOM_SITE_PREF = "custom_site_url";
var AUTO_SWITCH_PREF = "auto_switch_mirror";
var NEWEST_FIRST_PREF = "newest_first";
var IMAGE_SOURCE_PREF = "image_source";
var SHOW_LIST_COVER_PREF = "list_cover";
var LOGIN_ENABLED_PREF = "login_enabled";
var LOGIN_USER_PREF = "login_username";
var LOGIN_PASS_PREF = "login_password";
var LOGIN_COOKIE_PREF = "login_cookie";
var LOGIN_STATUS_PREF = "login_status";

// 未登录时 /shelf 页面上的原话（用它来判断登录到底成没成，不靠猜）
var NOT_LOGGED_IN_TEXT = "您还没有登录";

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
          summary: "章节列表把最新章节排在最前面；App 里若把章节排序改成「按章节号」，以 App 的为准",
          valueIndex: 0,
          entries: ["开", "关"],
          entryValues: ["1", "0"],
        },
      },
      {
        key: IMAGE_SOURCE_PREF,
        listPreference: {
          title: "阅读图源",
          summary: "本站章节页有两组图源，默认优先 FREEXCOMIC；该章没有选的这个源时会自动退回可用的那个",
          valueIndex: 0,
          entries: ["自动（优先 FREEXCOMIC）", "只用 FREEXCOMIC", "只用 NNHANMAN"],
          entryValues: ["", "FREEXCOMIC", "NNHANMAN"],
        },
      },
      {
        key: LOGIN_ENABLED_PREF,
        listPreference: {
          title: "启用账号登录",
          summary: "打开后会用下面的邮箱密码登录站点；「列表」里的「我的书架」需要它",
          valueIndex: 1,
          entries: ["开", "关"],
          entryValues: ["1", "0"],
        },
      },
      {
        key: LOGIN_USER_PREF,
        editTextPreference: {
          title: "账号（邮箱）",
          summary: "站点注册用的邮箱",
          value: "",
          dialogTitle: "账号（邮箱）",
          dialogMessage: "",
        },
      },
      {
        key: LOGIN_PASS_PREF,
        editTextPreference: {
          title: "密码",
          summary: "只存在本机；登录请求走 HTTPS",
          value: "",
          dialogTitle: "密码",
          dialogMessage: "",
        },
      },
      {
        key: SHOW_LIST_COVER_PREF,
        listPreference: {
          title: "列表封面",
          summary: "站点列表页不带封面，默认按标题推算（可能有个别占位图）",
          valueIndex: 0,
          entries: ["按标题推算", "不显示封面"],
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
    var h = {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: this.base + "/",
    };
    // 登录过就带上会话 cookie（Mangayomi 自己也会带它记住的 cookie，这里再兜一层）
    var cookie = this.sessionCookie;
    if (cookie) h["Cookie"] = cookie;
    return h;
  }

  /** 会话 cookie：先看内存，再看写进源设置里的那份。 */
  get sessionCookie() {
    if (this.cookieCache === undefined) {
      this.cookieCache = this.pref(LOGIN_COOKIE_PREF, "");
    }
    return this.cookieCache || "";
  }

  /** 把字符串写回源设置（Mangayomi 的 SharedPreferences 支持 setString）。 */
  savePref(key, value) {
    try {
      new SharedPreferences().setString(key, String(value == null ? "" : value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 账号登录
  //
  // 站点的登录是 Next.js 的服务端动作表单：隐藏字段 $ACTION_ID_<hex> 每次打开登录页都可能变，
  // 所以先 GET 一次登录页把 id 抠出来，再用 urlencoded 表单 POST 回去。
  // 判断成功不靠猜：登录后请求 /shelf，页面里还在说「您还没有登录」就是没成。
  // -------------------------------------------------------------------------

  async ensureLogin() {
    if (this.loginState === "ok") return "登录成功";
    if (!this.prefOn(LOGIN_ENABLED_PREF, false)) return "未启用（打开「启用账号登录」）";
    if (this.loginState === "failed") return this.pref(LOGIN_STATUS_PREF, "还没登录过");
    var status = await this.tryLogin();
    this.loginState = status.indexOf("登录成功") === 0 ? "ok" : "failed";
    this.savePref(LOGIN_STATUS_PREF, status);
    return status;
  }

  async tryLogin() {
    var user = this.pref(LOGIN_USER_PREF, "").trim();
    var password = this.pref(LOGIN_PASS_PREF, "");
    if (!user || !password) return "请先填邮箱和密码";
    try {
      var page = await this.getHtml("/login", null);
      var m = /\$ACTION_ID_([0-9a-f]{16,})/.exec(page);
      if (!m) return "登录页打不开或站点改版了（没找到登录表单）";
      var body =
        "$ACTION_ID_" + m[1] +
        "=&back=&email=" + encodeURIComponent(user) +
        "&password=" + encodeURIComponent(password);
      var res = await new Client().post(this.base + "/login", {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.base + "/login",
      }, body);
      var html = String(res && res.body ? res.body : "");
      var cookie = cookieFromHeaders(res && res.headers);
      if (cookie) {
        this.cookieCache = cookie;
        this.savePref(LOGIN_COOKIE_PREF, cookie);
      }
      var err = /text-red-500[^>]*>([^<]{2,40})</.exec(html);
      if (err) return "登录失败：" + err[1].trim();
      var shelf = await this.getHtml("/shelf", null);
      if (shelf.indexOf(NOT_LOGGED_IN_TEXT) !== -1) {
        return "登录没生效（站点仍认为未登录，请核对邮箱密码）";
      }
      return "登录成功：" + user;
    } catch (e) {
      return "登录请求失败：" + String(e && e.message ? e.message : e).slice(0, 60);
    }
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

  /** 列表页：每张卡片都是 a[href^=/comic/] */
  hasCards(html) {
    return html.indexOf("/comic/") !== -1;
  }

  hasDetail(html) {
    return html.indexOf("<h1") !== -1;
  }

  hasPages(html) {
    RE_IMAGE.lastIndex = 0;
    return RE_IMAGE.test(html);
  }

  hasChapters(html) {
    RE_SUBTITLE.lastIndex = 0;
    return RE_SUBTITLE.test(html);
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
      var cover = this.prefOn(SHOW_LIST_COVER_PREF, true) ? (coverMap && coverMap[name]) || coverUrl(name) : "";
      list.push({ name: name, imageUrl: cover, link: "/comic/" + id });
    }
    return list;
  }

  /** 首页和搜索都没有分页；只有标签页能翻页（靠 ?page=N）。 */
  /**
   * 「我的书架」：站点的 /shelf（登录后才是内容）。没登录就别装作拿到空列表，
   * 直接把登录状态抛出来，用户才知道要先去源设置里登录。
   */
  async shelfRequest(page) {
    var status = await this.ensureLogin();
    if (this.loginState !== "ok") {
      throw new Error(status + "（「我的书架」需要先在源设置里登录）");
    }
    return await this.listRequest("/shelf", page, false);
  }

  async listRequest(path, page, paged) {
    var html = await this.getHtml(path, "hasCards");
    var list = this.parseCards(new Document(html), coverMapFromHtml(html));
    var hasNextPage = false;
    if (paged && list.length > 0) {
      hasNextPage = html.indexOf("page=" + (page + 1)) !== -1;
    }
    return { list: list, hasNextPage: hasNextPage };
  }

  async getPopular(page, filters) {
    // 站点没有"热门"榜：默认用首页（只有第 1 页）。
    // Mangayomi 的筛选器一般只随 search 传进来，所以「列表=完本」主要靠空关键词搜索走 /complete。
    if (this.readListFilter(filters) === "complete") {
      return await this.listRequest("/complete?page=" + page, page, true);
    }
    if (this.readListFilter(filters) === "shelf") {
      return await this.shelfRequest(page);
    }
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

    // 没有标签时看「列表」：选了完本就走 /complete（12 条一页，可翻页）
    if (this.readListFilter(filters) === "complete") {
      return await this.listRequest("/complete?page=" + page, page, true);
    }
    if (this.readListFilter(filters) === "shelf") {
      return await this.shelfRequest(page);
    }

    if (page > 1) return { list: [], hasNextPage: false };
    return await this.listRequest("/home", 1, false);
  }

  // -------------------------------------------------------------------------
  // 详情
  // -------------------------------------------------------------------------

  async getDetail(url) {
    var html = await this.getHtml(this.pathOf(url), "hasDetail");
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
    // 站点是正序（第 1 话在前）；按设置决定是否反转成新章在前
    if (this.prefOn(NEWEST_FIRST_PREF, true)) episodes.reverse();

    // 站点没有统一的连载状态字段：详情页没有，但搜索结果卡片上有，多搜一次补回来
    var status = 5; // unknown（Mangayomi 的 status 是 0=连载中 1=已完结 5=未知）
    try {
      var comicId = this.comicId(this.pathOf(url));
      if (comicId) {
        var searchHtml = await this.getHtml("/search?key=" + encodeURIComponent(title), null);
        status = statusFromSearchHtml(searchHtml, comicId);
      }
    } catch (e) {
      status = 5;
    }

    return {
      name: title,
      imageUrl: cover,
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

    // 源设置里可以指定只用哪个图源；默认优先 FREEXCOMIC
    var preferred = this.pref(IMAGE_SOURCE_PREF, PREFERRED_IMAGE_SOURCE) || PREFERRED_IMAGE_SOURCE;
    var chosen = grouped[preferred] ? preferred : "";
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
    var html = await this.getHtml(this.pathOf(url), "hasChapters");
    var m = RE_NEXT.exec(html);
    return m ? m[1] : "";
  }

  async getPrevChapterId(url) {
    var html = await this.getHtml(this.pathOf(url), "hasChapters");
    var m = RE_PREV.exec(html);
    return m ? m[1] : "";
  }

  // -------------------------------------------------------------------------
  // 筛选器
  // -------------------------------------------------------------------------

  getFilterList() {
    var tagValues = [{ type_name: "SelectOption", name: "全部（首页）", value: "" }];
    for (var tag of TAGS) {
      tagValues.push({ type_name: "SelectOption", name: tag, value: tag });
    }
    return [
      {
        type: "list",
        name: "列表",
        type_name: "SelectFilter",
        values: [
          { type_name: "SelectOption", name: "首页", value: "" },
          { type_name: "SelectOption", name: "完本（可翻页）", value: "complete" },
          { type_name: "SelectOption", name: "我的书架（需登录）", value: "shelf" },
        ],
      },
      { type: "tag", name: "标签", type_name: "SelectFilter", values: tagValues },
    ];
  }

  /** 读筛选器里「列表」的选择；没选就返回空串（首页）。 */
  readListFilter(filters) {
    for (var filter of filters || []) {
      if (filter["type"] !== "list") continue;
      var values = filter["values"] || [];
      var picked = values[filter["state"] || 0];
      return picked ? String(picked.value || "") : "";
    }
    return "";
  }
}
