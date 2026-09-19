import 'package:mangayomi/bridge_lib.dart';

/// 91成人短剧（91crdj.com）— Mangayomi 动漫源（短剧视频）
///
/// 列表：热播榜 `/paihang/page/N/`；最新 `/duanju/page/N/`；分类 `/duanju|manju|zhenrenju|shipin/page/N/`
/// 搜索：`/search/?wd=<关键词>`
/// 详情：`/<格式>/<id>-<slug>/`（无剧集数据），改抓第一集页 `/<格式>/<id>-<slug>/1/` 里的
///      `<script id="playInitialData">` JSON：title / poster / description / eps / playBase
/// 播放：`/videos/<id>/episodes/<n>/playback` 返回 JSON，data.src 即带 auth_key 的 m3u8
class CrDj extends MProvider {
  CrDj({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  Future<String> fetch(String url) async {
    final res = await client.get(Uri.parse(url), headers: getHeader(baseUrl));
    return res.body;
  }

  // ---------- 通用 ----------

  String unescape(String s) {
    var out = s;
    out = out.replaceAll("\\u0026", "&");
    out = out.replaceAll("\\/", "/");
    out = out.replaceAll("\\\"", "\"");
    out = out.replaceAll("\\n", " ");
    out = out.replaceAll("\\r", " ");
    out = out.replaceAll("\\t", " ");
    out = out.replaceAll("&amp;", "&");
    out = out.replaceAll("&quot;", "\"");
    out = out.replaceAll("&#39;", "'");
    out = out.replaceAll("&lt;", "<");
    out = out.replaceAll("&gt;", ">");
    out = out.replaceAll("&nbsp;", " ");
    out = out.replaceAll("&ldquo;", "\u201c");
    out = out.replaceAll("&rdquo;", "\u201d");
    out = out.replaceAll("&hellip;", "\u2026");
    return out.trim();
  }

  String stripTags(String s) {
    var out = "";
    var p = 0;
    bool go = true;
    for (var n = 0; n < 2000 && go; n++) {
      final lt = s.indexOf("<", p);
      if (lt < 0) {
        out = out + s.substring(p);
        go = false;
      } else {
        out = out + s.substring(p, lt);
        final gt = s.indexOf(">", lt);
        if (gt < 0) {
          go = false;
        } else {
          p = gt + 1;
        }
      }
    }
    return out;
  }

  String clean(String s) {
    return unescape(stripTags(s));
  }

  /// 取 JSON 字符串值：从 `"key":"` 开始，到下一个未被转义的引号
  String jsonStr(String s, int from, String key) {
    final marker = '"' + key + '":"';
    final i = s.indexOf(marker, from);
    if (i < 0) {
      return "";
    }
    var p = i + marker.length;
    var buf = "";
    bool go = true;
    for (var n = 0; n < 6000 && go; n++) {
      if (p >= s.length) {
        go = false;
      } else {
        final c = s.substring(p, p + 1);
        if (c == "\\") {
          buf = buf + s.substring(p, p + 2);
          p = p + 2;
        } else if (c == "\"") {
          go = false;
        } else {
          buf = buf + c;
          p = p + 1;
        }
      }
    }
    return unescape(buf);
  }

  /// 详情页 / 剧集页里的 `<script id="playInitialData">` JSON
  String initialData(String html) {
    final i = html.indexOf('id="playInitialData"');
    if (i < 0) {
      return "";
    }
    final start = html.indexOf(">", i);
    final end = html.indexOf("</script>", start);
    if (start < 0 || end <= start) {
      return "";
    }
    return html.substring(start + 1, end);
  }

  /// 取 JSON 里最后一次出现的 "key":"值"（剧名 title 在 current.title 之后）
  String jsonStrLast(String s, String key) {
    final marker = '"' + key + '":"';
    var last = -1;
    var p = 0;
    bool go = true;
    for (var n = 0; n < 500 && go; n++) {
      final i = s.indexOf(marker, p);
      if (i < 0) {
        go = false;
      } else {
        last = i;
        p = i + 1;
      }
    }
    if (last < 0) {
      return "";
    }
    return jsonStr(s, last, key);
  }

  /// 列表卡片：`<a class="card" href="..." ...>` + `data-src="封面"` + `<h3>标题</h3>`
  List<MManga> parseCards(String html) {
    final list = <MManga>[];
    final marker = '<a class="card" href="';
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 80 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final href = substringBefore(html.substring(pos), '"');
        final end = (i + 2000 < html.length) ? i + 2000 : html.length;
        final win = html.substring(i, end);

        String name = "";
        final h3 = win.indexOf("<h3>");
        if (h3 >= 0) {
          final h3end = win.indexOf("</h3>", h3);
          if (h3end > h3) {
            name = clean(win.substring(h3 + 4, h3end));
          }
        }
        if (name.isEmpty) {
          final alt = win.indexOf('alt="');
          if (alt >= 0) {
            name = unescape(substringBefore(win.substring(alt + 5), '"'));
          }
        }

        if (href.contains("91crdj.com/") && name.isNotEmpty) {
          MManga m = MManga();
          m.name = name;
          m.link = href;
          // 站点封面是客户端解密的密文图，Mangayomi 拿不到明文，这里不设 imageUrl
          list.add(m);
        }
      }
    }
    return list;
  }

  bool hasNextPage(String html, int page) {
    final next = "/page/" + (page + 1).toString() + "/";
    return html.contains(next);
  }

  String pageUrl(String path, int page) {
    if (page <= 1) {
      return "$baseUrl$path";
    }
    return "$baseUrl$path" + "page/$page/";
  }

  // ---------- 入口 ----------

  @override
  Future<MPages> getPopular(int page) async {
    final html = await fetch(pageUrl("/paihang/", page));
    return MPages(parseCards(html), hasNextPage(html, page));
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    final html = await fetch(pageUrl("/duanju/", page));
    return MPages(parseCards(html), hasNextPage(html, page));
  }

  @override
  Future<MPages> search(String query, int page, FilterList filterList) async {
    String cat = "";
    for (var filter in filterList.filters) {
      if (filter.type == "Genre") {
        cat = filter.values[filter.state].value;
      }
    }
    if (query.isNotEmpty) {
      final q = Uri.encodeComponent(query);
      final html = await fetch("$baseUrl/search/?wd=$q");
      return MPages(parseCards(html), false);
    }
    if (cat.isEmpty) {
      final html = await fetch(pageUrl("/paihang/", page));
      return MPages(parseCards(html), hasNextPage(html, page));
    }
    final html = await fetch(pageUrl("/" + cat + "/", page));
    return MPages(parseCards(html), hasNextPage(html, page));
  }

  @override
  Future<MManga> getDetail(String url) async {
    MManga drama = MManga();
    drama.link = url;

    // 详情页只有标题/封面；剧集数据在第一集页的 playInitialData 里
    final dhtml = await fetch(url);
    String name = "";
    final og = dhtml.indexOf('property="og:title"');
    if (og >= 0) {
      final cIdx = dhtml.indexOf('content="', og);
      if (cIdx >= 0) {
        name = unescape(substringBefore(dhtml.substring(cIdx + 9), '"'));
      }
    }
    if (name.isEmpty) {
      final h1 = dhtml.indexOf("<h1");
      if (h1 >= 0) {
        final gt = dhtml.indexOf(">", h1);
        final en = dhtml.indexOf("</", gt);
        if (gt > 0 && en > gt) {
          name = clean(dhtml.substring(gt + 1, en));
        }
      }
    }
    if (name.isEmpty) {
      name = substringBefore(substringAfter(dhtml, "<title>"), "-").trim();
    }
    drama.name = name;

    String cover = "";
    final pIdx = dhtml.indexOf('class="poster"');
    if (pIdx >= 0) {
      final dIdx = dhtml.indexOf('data-src="', pIdx);
      if (dIdx >= 0 && dIdx < pIdx + 1200) {
        cover = substringBefore(dhtml.substring(dIdx + 10), '"');
      }
    }
    // 封面同样是密文图，不设 imageUrl

    // 第一集页拿剧集清单
    var first = url;
    if (!first.endsWith("/")) {
      first = first + "/";
    }
    final phtml = await fetch(first + "1/");
    final data = initialData(phtml);
    if (data.isNotEmpty) {
      final t = jsonStrLast(data, "title");
      if (t.isNotEmpty) {
        drama.name = t;
      }
      final desc = jsonStr(data, 0, "description");
      if (desc.isNotEmpty) {
        drama.description = desc;
      }
      var playBase = jsonStr(data, 0, "playBase");
      if (playBase.isEmpty) {
        playBase = first;
      }
      if (!playBase.endsWith("/")) {
        playBase = playBase + "/";
      }
      final chapters = <MChapter>[];
      var p = 0;
      bool go = true;
      for (var n = 0; n < 400 && go; n++) {
        final i = data.indexOf('{"n":', p);
        if (i < 0) {
          go = false;
        } else {
          p = i + 5;
          final seg = data.substring(p, (p + 12 < data.length) ? p + 12 : data.length);
          final numEnd = seg.indexOf(",");
          final numStr = (numEnd > 0) ? seg.substring(0, numEnd) : seg;
          final epTitle = jsonStr(data, i, "title");
          if (numStr.isNotEmpty && epTitle.isNotEmpty) {
            MChapter c = MChapter();
            c.name = epTitle;
            c.url = playBase + numStr + "/";
            chapters.add(c);
          }
        }
      }
      drama.chapters = chapters;
    } else {
      MChapter c = MChapter();
      c.name = name;
      c.url = first + "1/";
      drama.chapters = [c];
    }
    return drama;
  }

  String epNumber(String url) {
    var u = url;
    if (u.endsWith("/")) {
      u = u.substring(0, u.length - 1);
    }
    final i = u.lastIndexOf("/");
    if (i < 0) {
      return "1";
    }
    return u.substring(i + 1);
  }

  String videoId(String url) {
    var u = url;
    if (u.endsWith("/")) {
      u = u.substring(0, u.length - 1);
    }
    final i = u.lastIndexOf("/");
    if (i < 0) {
      return "";
    }
    final rest = u.substring(0, i);
    final j = rest.lastIndexOf("/");
    if (j < 0) {
      return "";
    }
    final seg = rest.substring(j + 1);
    final k = seg.indexOf("-");
    return (k > 0) ? seg.substring(0, k) : seg;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    final videos = <MVideo>[];
    final headers = {"Referer": "$baseUrl/"};

    final id = videoId(url);
    final ep = epNumber(url);

    // 优先走播放接口，直接拿到带 auth_key 的 m3u8
    if (id.isNotEmpty) {
      try {
        final body = await fetch("$baseUrl/videos/$id/episodes/$ep/playback");
        final src = jsonStr(body, 0, "src");
        if (src.isNotEmpty && src.startsWith("http")) {
          videos.add(MVideo(src, "默认", src, headers: headers));
          return videos;
        }
      } catch (e) {
        // 落到剧集页解析
      }
    }

    // 兜底：从剧集页的 playInitialData.current.src 取
    try {
      final html = await fetch(url);
      final data = initialData(html);
      final cIdx = data.indexOf('"current"');
      final src = (cIdx >= 0) ? jsonStr(data, cIdx, "src") : "";
      if (src.isNotEmpty && src.startsWith("http")) {
        videos.add(MVideo(src, "默认", src, headers: headers));
      }
    } catch (e) {
      // 返回空列表
    }
    return videos;
  }

  @override
  Future<List<dynamic>> getPageList(String url) async {
    return [];
  }

  @override
  Future<String> getHtmlContent(String name, String url) async {
    return fetch(url);
  }

  @override
  Future<String> cleanHtmlContent(String html) async {
    return html;
  }

  @override
  List<dynamic> getFilterList() {
    return [
      SelectFilter("Genre", "分类", 0, [
        SelectFilterOption("全部（热播榜）", ""),
        SelectFilterOption("成人短剧", "duanju"),
        SelectFilterOption("成人漫剧", "manju"),
        SelectFilterOption("真人剧", "zhenrenju"),
        SelectFilterOption("成人视频", "shipin"),
      ]),
    ];
  }

  @override
  List<dynamic> getSourcePreferences() {
    return [];
  }
}

Map<String, String> getHeader(String url) {
  return {
    "Referer": "$url/",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7",
  };
}

CrDj main(MSource source) {
  return CrDj(source: source);
}
