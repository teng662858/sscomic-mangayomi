// Mangayomi JS 源模板（由 gen_js_sources.mjs 填充）
// 说明：这些站的列表/详情/章节结构和 Tachimanga 版一一对应，选择器都是从真实页面实测来的。
const mangayomiSources = [
  {
    "name": "禁漫大王",
    "lang": "zh",
    "baseUrl": "https://jmdw8.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/teng662858/sscomic-tachimanga/refs/heads/main/icons/jmdw8.png",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "version": "0.1.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "manga/src/zh/jmdw8.js",
  },
];

const MIRRORS = ["https://jmdw8.com"];
const POPULAR = "/renew?page={p}";
const LATEST = "/renew?page={p}";
const SEARCH = "/cata.php?key={q}";
const CATALOGS = [{ name: "最近更新", value: "/renew?page={p}" }, { name: "全部漫画", value: "/sort/all/ob/time/st/all/page/{p}" }, { name: "已完结", value: "/sort/all/ob/time/st/completed/page/{p}" }, { name: "连载中", value: "/sort/all/ob/time/st/serialized/page/{p}" }, { name: "韩漫", value: "/sort/韩漫/ob/time/st/all/page/{p}" }, { name: "日漫", value: "/sort/日漫/ob/time/st/all/page/{p}" }, { name: "3D漫画", value: "/sort/3D漫画/ob/time/st/all/page/{p}" }, { name: "美女", value: "/sort/美女/ob/time/st/all/page/{p}" }, { name: "短篇", value: "/sort/短篇/ob/time/st/all/page/{p}" }, { name: "同性", value: "/sort/同性/ob/time/st/all/page/{p}" }];
const CARD_SEL = "a.thumbnail";
const LINK_FROM = "";
const TITLE_FROM = "h2 a";
const COVER_FROM = "img";
const COVER_ATTRS = ["data-original", "data-src", "src"];
const SKIP_SEL = "";
const DETAIL_TITLE = "h1";
const DETAIL_COVER = ".module-item-pic img, .video-info-pic img";
const CHAP_SEL = "a[href*='/view/'][title*='第']";
const CHAP_NAME_ATTR = "title";
const IMG_SEL = ".content img, img[data-src]";
const IMG_ATTRS = ["data-src", "data-original", "src"];

const SITE_PREF = "site_base_url";
const CUSTOM_SITE_PREF = "custom_site_url";
const NEWEST_FIRST_PREF = "newest_first";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/604.1";
const SKIP_IMG_RX = /logo|icon|avatar|blank|loading|placeholder|spacer|qrcode|banner|广告|yandex|watch\/|1x1|pixel|(?:^|[/_.-])ads?(?:[/_.-]|$)/i;
const LOOKS_IMG_RX = /\.(jpe?g|png|webp|gif)|imgBridge|covBridge|\/upload|manga_pics|bookimages|\/content\/|\/static\//i;
const CHAPTER_NO_RX = /第\s*(\d+(?:\.\d+)?)\s*[话話章回]/;
const ONCLICK_RX = /location\.href\s*=\s*['"]([^'"]+)['"]/;

class DefaultExtension extends MProvider {
  get source() {
    return mangayomiSources[0];
  }

  pref(key, fallback) {
    try {
      const saved = new SharedPreferences().get(key);
      if (saved === undefined || saved === null || saved === "") return fallback;
      return String(saved);
    } catch (e) {
      return fallback;
    }
  }

  prefOn(key, fallback) {
    const v = this.pref(key, fallback ? "1" : "0").toLowerCase();
    return v === "1" || v === "true";
  }

  get mirrors() {
    const custom = this.pref(CUSTOM_SITE_PREF, "").trim();
    if (custom) return [(/^https?:\/\//i.test(custom) ? custom : "https://" + custom).replace(/\/+$/, "")];
    const picked = this.pref(SITE_PREF, "").trim().replace(/\/+$/, "");
    const list = MIRRORS.slice();
    if (picked && list.indexOf(picked) === -1) list.unshift(picked);
    return list;
  }

  get base() {
    return this.mirrors[0];
  }

  get headers() {
    return { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", Referer: this.base + "/" };
  }

  /** 站内相对路径（配置里可能带完整地址，统一去掉域名） */
  pathOf(url) {
    const raw = String(url || "").trim();
    if (raw === "") return "/";
    const noHost = raw.replace(/^https?:\/\/[^/]+/, "");
    const p = noHost === "" ? "/" : noHost;
    return p.startsWith("/") ? p : "/" + p;
  }

  async getHtml(path) {
    let last = "拿不到内容";
    const list = this.mirrors;
    for (let i = 0; i < list.length; i++) {
      try {
        const res = await new Client().get(list[i] + this.pathOf(path), this.headers);
        const body = res && res.body ? String(res.body) : "";
        // 注意：正常页面里也有 challenge-platform，判定被拦只看标题是不是质询页
        const cfTitle = (/<title[^>]*>([^<]*)<\/title>/i.exec(body) || [, ""])[1];
        if (body && !/Just a moment|请稍候|Attention Required|Verifying you are human/i.test(cfTitle)) return body;
        last = body ? "页面结构与预期不符" : "空响应";
      } catch (e) {
        last = String(e && e.message ? e.message : e).slice(0, 40);
      }
    }
    throw new Error("取不到内容（" + last + "）。可在「源设置 → 站点地址」里换一个域名。");
  }

  text(el) {
    return el ? String(el.text || "").trim() : "";
  }

  attr(el, name) {
    return el ? String(el.attr(name) || "").trim() : "";
  }

  /** 列表地址：分类 +（站点支持时）排序 / 状态 */
  listPath(page, filters) {
    let picked = { catalog: "", sort: 0, status: 0 };
    for (const f of filters || []) {
      if (f["type"] === "catalog") picked.catalog = (f.values[f.state || 0] || {}).value || "";
      if (f["type"] === "sort") picked.sort = f.state || 0;
      if (f["type"] === "status") picked.status = f.state || 0;
    }
    let path = this.pathOf(picked.catalog || POPULAR);
    if (path.indexOf("/ob/") !== -1 && path.indexOf("/st/") !== -1) {
      const ob = picked.sort === 1 ? "hits" : "time";
      const st = picked.status === 1 ? "completed" : picked.status === 2 ? "serialized" : "all";
      path = path.replace(/\/ob\/(time|hits)\//, "/ob/" + ob + "/").replace(/\/st\/(all|completed|serialized)\//, "/st/" + st + "/");
    }
    return path.replace("{p}", String(page));
  }

  async listRequest(path, page, paged) {
    const html = await this.getHtml(path);
    const doc = new Document(html);
    const list = [];
    const seen = {};
    for (const el of doc.select(CARD_SEL)) {
      // 注意：要判「祖先自己就是 .pops_list」，不能判「祖先里含有 .pops_list」——
      // body 里当然含，那样会把整页卡片全跳过。
      if (SKIP_SEL !== "" && el.parents) {
        const ps = el.parents();
        if (Array.isArray(ps) && ps.some((x) => x.is && x.is(SKIP_SEL))) continue;
      }
      const item = this.cardToManga(el);
      if (!item || seen[item.link]) continue;
      seen[item.link] = true;
      list.push(item);
    }
    return { list: list, hasNextPage: paged !== false && list.length >= 8 && page < 300 };
  }

  cardToManga(el) {
    let linkEl = el;
    if (LINK_FROM) linkEl = el.selectFirst(LINK_FROM) || el;
    let href = this.attr(linkEl, "href") || this.attr(el, "href");
    if (!href) {
      const oc = ONCLICK_RX.exec(this.attr(linkEl, "onclick") || this.attr(el, "onclick") || "");
      href = oc ? oc[1] : "";
    }
    if (!href && el.select) {
      for (const child of el.select("[onclick], a[href]")) {
        const h = this.attr(child, "href");
        if (h) { href = h; break; }
        const oc = ONCLICK_RX.exec(this.attr(child, "onclick"));
        if (oc) { href = oc[1]; break; }
      }
    }
    if (!href || href.indexOf("javascript") === 0 || href.indexOf("#") === 0) return null;
    let title = this.attr(el, "title") || this.attr(linkEl, "title") || "";
    if (!title && TITLE_FROM) {
      let scope = el;
      for (let d = 0; d < 3 && scope; d++) {
        const found = scope.selectFirst ? scope.selectFirst(TITLE_FROM) : null;
        const t = this.text(found);
        if (t) { title = t; break; }
        scope = scope.parent ? scope.parent() : null;
      }
    }
    if (!title) title = this.text(linkEl) || this.text(el);
    if (!title) return null;
    return { name: title, link: this.pathOf(href), imageUrl: this.coverOf(el) };
  }

  coverOf(el) {
    const holder = !COVER_FROM || COVER_FROM === "self" ? el : el.selectFirst(COVER_FROM) || el;
    for (const attr of COVER_ATTRS) {
      let v = this.attr(holder, attr);
      if (!v && holder.selectFirst) v = this.attr(holder.selectFirst("img"), attr);
      if (v && !SKIP_IMG_RX.test(v)) return v.startsWith("http") ? v : this.base + v;
    }
    const style = this.attr(holder, "style");
    const m = /url\(['"]?([^'")]+)/.exec(style);
    if (m) return m[1].startsWith("http") ? m[1] : this.base + m[1];
    if (holder.selectFirst) {
      const srcset = this.attr(holder.selectFirst("source[srcset]"), "srcset");
      if (srcset) {
        const first = srcset.split(" ")[0];
        if (first) return first.startsWith("http") ? first : this.base + first;
      }
    }
    return "";
  }

  async getPopular(page, filters) {
    return await this.listRequest(this.listPath(page, filters), page, true);
  }

  async getLatestUpdates(page) {
    return await this.listRequest(this.pathOf(LATEST).replace("{p}", String(page)), page, true);
  }

  async search(query, page, filters) {
    const keyword = String(query || "").trim();
    const path = keyword === ""
      ? this.listPath(page, filters)
      : this.pathOf(SEARCH).replace("{q}", encodeURIComponent(keyword)).replace("{p}", String(page));
    return await this.listRequest(path, page, true);
  }

  async getDetail(url) {
    const html = await this.getHtml(this.pathOf(url));
    const doc = new Document(html);
    const title = this.text(doc.selectFirst(DETAIL_TITLE)) || this.text(doc.selectFirst("title"));
    if (title === "") throw new Error("解析详情失败，页面结构与预期不符：" + url);

    const coverEl = doc.selectFirst(DETAIL_COVER);
    let cover = coverEl ? this.attr(coverEl, "src") || this.attr(coverEl, "data-src") || this.attr(coverEl, "data-original") : "";
    if (!cover && coverEl) {
      const m = /url\(['"]?([^'")]+)/.exec(this.attr(coverEl, "style"));
      if (m) cover = m[1];
    }

    const bodyText = doc.text || "";
    let author = "";
    const ai = bodyText.indexOf("作者");
    if (ai >= 0) {
      author = bodyText.slice(ai + 2, ai + 62).replace(/^\s*[:：]\s*/, "");
      for (const label of ["标签", "標籤", "状态", "狀態", "更新", "简介", "簡介", "类型", "類型", "地区", "地區", "别名", "別名", "评分", "評分", "点击", "點擊", "作者", "来源", "來源"]) {
        const at = author.indexOf(label);
        if (at > 0) author = author.slice(0, at);
      }
      author = author.trim().replace(/[：:\/\-·\s]+$/, "").slice(0, 40);
    }

    let status = 5;
    if (/已完|完結|完结|完本/.test(bodyText)) status = 1;
    else if (/連載|连载/.test(bodyText)) status = 0;

    const genre = [];
    for (const a of doc.select("a[href*='tag'], a[href*='cata'], a[href*='sort'], a[href*='type'], a[href*='/item/']")) {
      const g = this.text(a).replace(/\s*>\s*$/, "").trim();
      if (g && g.length <= 12 && genre.indexOf(g) === -1) genre.push(g);
    }

    const episodes = [];
    const seen = {};
    for (const el of doc.select(CHAP_SEL)) {
      const href = this.attr(el, "href");
      if (!href || href.indexOf("javascript") === 0 || href.indexOf("#") === 0) continue;
      const raw = this.attr(el, CHAP_NAME_ATTR || "title") || this.text(el);
      let name = String(raw).trim().replace(/\s+/g, " ");
      const stripped = name.replace(/^开始阅读/, "").trim().replace(/^[(（]|[)）]$/g, "").trim();
      if (stripped) name = stripped;
      const pm = /^(.{2,60}?)-(第\s*\d+.*|最終話.*|最终话.*|後記.*|后记.*|番外.*|公告.*|休刊.*)$/.exec(name);
      if (pm && pm[1].length >= 2) name = pm[2].trim();
      if (!name || name.length > 120) continue;
      const link = this.pathOf(href);
      if (seen[link]) continue;
      seen[link] = true;
      episodes.push({ name: name, url: link });
    }
    // 站点顺序有的正序有的倒序：统一成「第 1 话在前」，再按设置决定是否反过来
    const numbered = episodes.filter((e) => CHAPTER_NO_RX.test(e.name));
    if (numbered.length >= 2 && numbered.length >= episodes.length - 1) {
      const first = Number(CHAPTER_NO_RX.exec(numbered[0].name)[1]);
      const last = Number(CHAPTER_NO_RX.exec(numbered[numbered.length - 1].name)[1]);
      if (first > last) episodes.reverse();
    }
    if (this.prefOn(NEWEST_FIRST_PREF, true)) episodes.reverse();

    return { name: title, imageUrl: cover, description: bodyText.slice(0, 200), genre: genre, author: author, status: status, episodes: episodes };
  }

  async getPageList(url) {
    const html = await this.getHtml(this.pathOf(url));
    const doc = new Document(html);
    const out = [];
    for (const el of doc.select(IMG_SEL)) {
      let value = "";
      for (const attr of IMG_ATTRS) {
        const v = this.attr(el, attr);
        if (v) { value = v; break; }
      }
      if (!value || SKIP_IMG_RX.test(value) || !LOOKS_IMG_RX.test(value)) continue;
      const abs = value.startsWith("http") ? value : this.base + value;
      if (out.indexOf(abs) === -1) out.push(abs);
    }
    if (out.length === 0) throw new Error("这一章没解析出图片（站点可能改版了）。");
    return out;
  }

  getFilterList() {
    const cats = [];
    for (const c of CATALOGS) cats.push({ type_name: "SelectOption", name: c.name, value: c.value });
    const filters = [];
    const hasSortStatus = CATALOGS.some((c) => c.value.indexOf("/ob/") !== -1 && c.value.indexOf("/st/") !== -1);
    if (hasSortStatus) {
      filters.push({ type: "sort", name: "排序", type_name: "SelectFilter", values: [
        { type_name: "SelectOption", name: "最新", value: "time" },
        { type_name: "SelectOption", name: "热门", value: "hits" },
      ] });
      filters.push({ type: "status", name: "状态", type_name: "SelectFilter", values: [
        { type_name: "SelectOption", name: "全部", value: "all" },
        { type_name: "SelectOption", name: "已完结", value: "completed" },
        { type_name: "SelectOption", name: "连载中", value: "serialized" },
      ] });
    }
    filters.push({ type: "catalog", name: "分类", type_name: "SelectFilter", values: cats });
    return filters;
  }

  getSourcePreferences() {
    const entries = MIRRORS.map((m) => m.replace(/^https?:\/\//, ""));
    return [
      { key: SITE_PREF, listPreference: { title: "站点地址", summary: "打不开就换一个；解析不到内容时也会自动顺延下一个", valueIndex: 0, entries: entries, entryValues: MIRRORS } },
      { key: CUSTOM_SITE_PREF, editTextPreference: { title: "自定义域名", summary: "留空则用上面的站点地址；填了以它为准（只填域名也行，会自动补 https://）", value: "", dialogTitle: "自定义域名", dialogMessage: "" } },
      { key: NEWEST_FIRST_PREF, listPreference: { title: "新章在前", summary: "章节列表把最新章节排在最前面；App 里若改成按章节号排序，以 App 的为准", valueIndex: 0, entries: ["开", "关"], entryValues: ["1", "0"] } },
    ];
  }
}
