import 'package:mangayomi/bridge_lib.dart';

/// 福利姬（fljtu14.xyz）— Mangayomi 漫画源（图片图集）
///
/// 站点把整页藏成 `document.write(decodeURIComponent(atob("...")))`，纯 HTTP 只会
/// 拿到壳（内容要等浏览器 load 事件后才写出来）。做法：在应用内 WebView 里等到
/// 真实内容标记出现（或自己对 atob 载荷解码）后，把渲染好的 HTML 取回来解析。
///
/// 列表：分类 `/artshow-<id>/`、排序 `/artshow-<id>/by/time|hits|score/`、
///      搜索 `/artsearch/?wd=<关键词>`
/// 详情：`/artdetail-<id>/`，正文图在 `<div class="art-detail-content">` 内
class FljTu extends MProvider {
  FljTu({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  static const String kListMarker = 'class="wntheme-vodlist__thumb lazyload"';
  static const String kDetailMarker = 'class="art-detail-content"';

  String jsStr(String s) {
    return s.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  }

  /// WebView 取页：等到 [marker] 出现（或直接解 atob 载荷）
  Future<String> fetchSmart(String url, String marker) async {
    String httpHtml = "";
    try {
      final res = await client.get(Uri.parse(url), headers: getHeader(baseUrl));
      httpHtml = res.body;
      if (!httpHtml.contains("atob(") && httpHtml.contains(marker)) {
        return httpHtml;
      }
    } catch (e) {
      httpHtml = "";
    }
    final mk = jsStr(marker);
    final script =
        "(function(){var t=0;var iv=setInterval(function(){t++;"
        "var h=document.documentElement.outerHTML;"
        "if(h.indexOf('" +
        mk +
        "')!==-1){clearInterval(iv);"
        "window.flutter_inappwebview.callHandler('setResponse',h);return;}"
        "var m=h.match(/atob\\(\"([^\"]+)\"\\)/);"
        "if(m){try{var d=decodeURIComponent(atob(m[1]));"
        "if(d.indexOf('" +
        mk +
        "')!==-1){clearInterval(iv);"
        "window.flutter_inappwebview.callHandler('setResponse',d);return;}}catch(e){}}"
        "if(t>25){clearInterval(iv);"
        "window.flutter_inappwebview.callHandler('setResponse','DBG no-marker len='+h.length);}"
        "},400);})()";
    try {
      final result = await evaluateJavascriptViaWebview(url, {}, [
        script,
      ], time: 45);
      final out = result == null ? "" : result.toString();
      if (out.isNotEmpty && !out.startsWith("DBG")) {
        return out;
      }
      return httpHtml;
    } catch (e) {
      return httpHtml;
    }
  }

  // ---------- 通用 ----------

  String unescape(String s) {
    var out = s;
    out = out.replaceAll("&amp;", "&");
    out = out.replaceAll("&quot;", "\"");
    out = out.replaceAll("&#39;", "'");
    out = out.replaceAll("&#039;", "'");
    out = out.replaceAll("&apos;", "'");
    out = out.replaceAll("&lt;", "<");
    out = out.replaceAll("&gt;", ">");
    out = out.replaceAll("&nbsp;", " ");
    out = out.replaceAll("&ldquo;", "\u201c");
    out = out.replaceAll("&rdquo;", "\u201d");
    out = out.replaceAll("&hellip;", "\u2026");
    out = out.replaceAll("&mdash;", "\u2014");
    out = out.replaceAll("&middot;", "\u00b7");
    return out.trim();
  }

  String attrOf(String s, int from, String name) {
    final marker = name + '="';
    final i = s.indexOf(marker, from);
    if (i < 0) {
      return "";
    }
    return substringBefore(s.substring(i + marker.length), '"');
  }

  String absUrl(String u) {
    if (u.isEmpty || u.startsWith("http")) {
      return u;
    }
    if (u.startsWith("//")) {
      return "https:" + u;
    }
    if (u.startsWith("/")) {
      return baseUrl + u;
    }
    return baseUrl + "/" + u;
  }

  /// 列表项：`<a class="wntheme-vodlist__thumb lazyload" href="/artdetail-<id>/" title="标题" data-original="封面">`
  List<MManga> parseCards(String html) {
    final list = <MManga>[];
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 60 && go; n++) {
      final i = html.indexOf(kListMarker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + kListMarker.length;
        final win = html.substring(
          i,
          (i + 900 < html.length) ? i + 900 : html.length,
        );
        final href = attrOf(win, 0, 'href');
        final title = unescape(attrOf(win, 0, 'title'));
        var cover = attrOf(win, 0, 'data-original');
        if (cover.isEmpty) {
          cover = attrOf(win, 0, 'src');
        }
        if (href.contains("/artdetail-") && title.isNotEmpty) {
          MManga m = MManga();
          m.name = title;
          m.link = absUrl(href);
          m.imageUrl = absUrl(cover);
          list.add(m);
        }
      }
    }
    return list;
  }

  bool hasNextPage(String html, int page) {
    final next = (page + 1).toString();
    return html.contains("/index-" + next + ".html") ||
        html.contains("page=" + next);
  }

  String listUrl(String cat, String sort, int page) {
    var path = "/artshow-" + (cat.isEmpty ? "1" : cat) + "/";
    if (sort.isNotEmpty) {
      path = path + "by/" + sort + "/";
    }
    if (page > 1) {
      path = path + "index-" + page.toString() + ".html";
    }
    return baseUrl + path;
  }

  // ---------- 入口 ----------

  @override
  Future<MPages> getPopular(int page) async {
    final html = await fetchSmart(listUrl("1", "hits", page), kListMarker);
    final list = parseCards(html);
    return MPages(list, hasNextPage(html, page));
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    final html = await fetchSmart(listUrl("1", "time", page), kListMarker);
    final list = parseCards(html);
    return MPages(list, hasNextPage(html, page));
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
      final html = await fetchSmart("$baseUrl/artsearch/?wd=$q", kListMarker);
      return MPages(parseCards(html), false);
    }
    final html = await fetchSmart(listUrl(cat, "time", page), kListMarker);
    final list = parseCards(html);
    return MPages(list, hasNextPage(html, page));
  }

  /// 正文图：`<div class="art-detail-content">` 里的 img
  List<String> parseImages(String html) {
    final out = <String>[];
    final start = html.indexOf(kDetailMarker);
    if (start < 0) {
      return out;
    }
    final end = (start + 300000 < html.length) ? start + 300000 : html.length;
    final body = html.substring(start, end);
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 600 && go; n++) {
      final i = body.indexOf("<img", pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + 4;
        final win = body.substring(
          i,
          (i + 600 < body.length) ? i + 600 : body.length,
        );
        var src = attrOf(win, 0, 'src');
        if (src.isEmpty) {
          src = attrOf(win, 0, 'data-original');
        }
        if (src.isNotEmpty &&
            (src.contains("/upload/") || src.startsWith("http"))) {
          out.add(absUrl(src));
        }
      }
    }
    return out;
  }

  @override
  Future<MManga> getDetail(String url) async {
    MManga album = MManga();
    album.link = url;
    final html = await fetchSmart(url, kDetailMarker);

    String title = "";
    final t = html.indexOf("<title>");
    if (t >= 0) {
      final e = html.indexOf("</title>", t);
      if (e > t) {
        title = unescape(substringBefore(html.substring(t + 7, e), "|"));
      }
    }
    if (title.isEmpty) {
      title = url;
    }
    album.name = title;

    final desc = html.indexOf('name="description"');
    if (desc >= 0) {
      final cIdx = html.indexOf('content="', desc);
      if (cIdx >= 0 && cIdx + 9 < html.length) {
        album.description = unescape(
          substringBefore(html.substring(cIdx + 9), '"'),
        );
      }
    }

    final imgs = parseImages(html);
    if (imgs.isNotEmpty) {
      album.imageUrl = imgs[0];
    }

    final chapters = <MChapter>[];
    MChapter c = MChapter();
    c.name = title + "（" + imgs.length.toString() + "P）";
    c.url = url;
    c.thumbnailUrl = album.imageUrl;
    chapters.add(c);
    album.chapters = chapters;
    return album;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    return [];
  }

  @override
  Future<List<dynamic>> getPageList(String url) async {
    final html = await fetchSmart(url, kDetailMarker);
    return parseImages(html);
  }

  @override
  Future<String> getHtmlContent(String name, String url) async {
    return fetchSmart(url, kDetailMarker);
  }

  @override
  Future<String> cleanHtmlContent(String html) async {
    return html;
  }

  @override
  List<dynamic> getFilterList() {
    return [
      SelectFilter("Genre", "分类", 0, [
        SelectFilterOption("全部", "1"),
        SelectFilterOption("分类2", "2"),
        SelectFilterOption("分类3", "3"),
        SelectFilterOption("分类4", "4"),
        SelectFilterOption("网络来源", "5"),
        SelectFilterOption("少女福利姬", "6"),
        SelectFilterOption("AI系列", "7"),
        SelectFilterOption("分类8", "8"),
        SelectFilterOption("分类9", "9"),
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

FljTu main(MSource source) {
  return FljTu(source: source);
}
