import 'package:mangayomi/bridge_lib.dart';

/// 黄果剧场（huangguo.video）— Mangayomi 动漫源（AI 成人短剧 / 剧集）
///
/// 列表：最新 `/videos?page=N`；排行 `/ranking`；分类 `/videos?category=1|2|3|4&page=N`
/// 搜索：`/search?q=<关键词>`
/// 详情：`/video/<slug>`，播放清单在 `<div data-hg-player data-hls="/uploads/content/video/<id>/master.m3u8">`
/// 连续剧：详情页里链接到 `/series/<slug>`，剧集列表在那里，每集是 `/video/<slug>`
///
/// 站点整站在 Cloudflare 后面（HTML 直连返回 403 Attention Required），但
/// `/uploads/...` 媒体路径不拦。所以 HTML 走「先 HTTP、被拦就换应用内 WebView」，
/// 播放地址直接用节点里的 m3u8。
class HuangGuo extends MProvider {
  HuangGuo({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  Future<String> fetchHttp(String url) async {
    final res = await client.get(Uri.parse(url), headers: getHeader(baseUrl));
    return res.body;
  }

  bool looksBlocked(String body) {
    return body.contains("Attention Required") ||
        body.contains("cf-error-details") ||
        body.contains("Just a moment") ||
        body.contains("__cf_chl_tk");
  }

  /// 用应用内 WebView 取页，等到 [marker] 出现（真实内容渲染完）或超时
  Future<String> fetchViaWebview(String url, String marker) async {
    final script =
        "(function(){var t=0;var iv=setInterval(function(){t++;"
        "var h=document.documentElement.outerHTML;"
        "if(h.indexOf('" +
        marker +
        "')!==-1||t>50){clearInterval(iv);"
        "window.flutter_inappwebview.callHandler('setResponse',h);}"
        "},1000);})()";
    try {
      final result = await evaluateJavascriptViaWebview(url, {}, [
        script,
      ], time: 60);
      return result == null ? "" : result.toString();
    } catch (e) {
      return "";
    }
  }

  Future<String> fetchSmart(String url, String marker) async {
    String html = "";
    try {
      html = await fetchHttp(url);
    } catch (e) {
      html = "";
    }
    if (html.isNotEmpty && html.contains(marker) && !looksBlocked(html)) {
      return html;
    }
    final viaWebview = await fetchViaWebview(url, marker);
    if (viaWebview.isNotEmpty &&
        (viaWebview.contains(marker) || viaWebview.length > html.length)) {
      return viaWebview;
    }
    return html;
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

  /// 去掉标签后的纯文本，用于章节名兜底
  String plain(String s) {
    var out = "";
    var p = 0;
    bool go = true;
    for (var n = 0; n < 400 && go; n++) {
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
    return unescape(out).trim();
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
    if (u.isEmpty) {
      return "";
    }
    if (u.startsWith("http")) {
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

  /// 列表卡片：`<article class="video-card ...">` + `/video/<slug>` + 封面 + 标题
  List<MManga> parseCards(String html) {
    final list = <MManga>[];
    final marker = '<article class="video-card';
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 60 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final end = (i + 2500 < html.length) ? i + 2500 : html.length;
        final win = html.substring(i, end);

        final href = attrOf(win, 0, 'href');
        String title = unescape(attrOf(win, 0, 'alt'));
        if (title.isEmpty) {
          final pIdx = win.indexOf('text-cream truncate');
          if (pIdx >= 0) {
            final gt = win.indexOf(">", pIdx);
            final en = win.indexOf("</", gt);
            if (gt > 0 && en > gt) {
              title = unescape(win.substring(gt + 1, en));
            }
          }
        }

        String img = "";
        final imgIdx = win.indexOf('video-cover-img');
        if (imgIdx >= 0) {
          final sIdx = win.indexOf('src="', imgIdx);
          if (sIdx >= 0) {
            img = absUrl(substringBefore(win.substring(sIdx + 5), '"'));
          }
        }

        if ((href.contains("/video/") || href.contains("/series/")) &&
            title.isNotEmpty) {
          MManga m = MManga();
          m.name = title;
          m.link = absUrl(href);
          m.imageUrl = img;
          list.add(m);
        }
      }
    }
    return list;
  }

  bool hasNextPage(String html, int page) {
    final next = "page=" + (page + 1).toString();
    return html.contains(next);
  }

  // ---------- 入口 ----------

  @override
  Future<MPages> getPopular(int page) async {
    final url = (page <= 1) ? "$baseUrl/ranking" : "$baseUrl/ranking?page=$page";
    final html = await fetchSmart(url, "video-card");
    return MPages(parseCards(html), hasNextPage(html, page));
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    final url = (page <= 1) ? "$baseUrl/videos" : "$baseUrl/videos?page=$page";
    final html = await fetchSmart(url, "video-card");
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
      var url = "$baseUrl/search?q=$q";
      if (page > 1) {
        url = url + "&page=$page";
      }
      final html = await fetchSmart(url, "video-card");
      return MPages(parseCards(html), hasNextPage(html, page));
    }
    if (cat.isEmpty) {
      return getPopular(page);
    }
    var url = "$baseUrl/videos?category=$cat";
    if (page > 1) {
      url = url + "&page=$page";
    }
    final html = await fetchSmart(url, "video-card");
    return MPages(parseCards(html), hasNextPage(html, page));
  }

  /// 剧集页里的分集列表（集名在缩略图 alt 中，例如 alt="第11集"）
  List<MChapter> parseEpisodes(String html) {
    final chapters = <MChapter>[];
    final marker = 'href="/video/';
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 400 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final href = substringBefore(html.substring(i + 6), '"');
        if (href.contains("/video/")) {
          final end = (i + 1200 < html.length) ? i + 1200 : html.length;
          final win = html.substring(i, end);
          var label = unescape(attrOf(win, 0, 'alt'));
          if (label.isEmpty) {
            label = plain(win);
          }
          if (label.length > 40 || label.contains("{") || label.contains(";")) {
            label = "";
          }
          MChapter c = MChapter();
          c.name = label.isNotEmpty
              ? label
              : ("第 " + (n + 1).toString() + " 集");
          c.url = absUrl(href);
          chapters.add(c);
        }
      }
    }
    return chapters;
  }

  @override
  Future<MManga> getDetail(String url) async {
    MManga drama = MManga();
    drama.link = url;

    final isSeries = url.contains("/series/");
    final html = await fetchSmart(
      url,
      isSeries ? "series-episodes" : "data-hg-player",
    );

    String title = "";
    final h1 = html.indexOf("<h1");
    if (h1 >= 0) {
      final gt = html.indexOf(">", h1);
      final en = html.indexOf("</", gt);
      if (gt > 0 && en > gt) {
        title = unescape(html.substring(gt + 1, en));
      }
    }
    if (title.isEmpty) {
      title = unescape(attrOf(html, 0, "og:title"));
    }
    if (title.isEmpty) {
      title = substringBefore(substringAfter(html, "<title>"), "·").trim();
    }
    drama.name = title;

    var cover = absUrl(attrOf(html, 0, "data-poster"));
    if (cover.isEmpty) {
      final og = html.indexOf('property="og:image"');
      if (og >= 0) {
        final cIdx = html.indexOf('content="', og);
        if (cIdx >= 0) {
          cover = absUrl(substringBefore(html.substring(cIdx + 9), '"'));
        }
      }
    }
    drama.imageUrl = cover;

    final desc = html.indexOf('name="description"');
    if (desc >= 0) {
      final cIdx = html.indexOf('content="', desc);
      if (cIdx >= 0) {
        drama.description = unescape(
          substringBefore(html.substring(cIdx + 9), '"'),
        );
      }
    }

    var chapters = <MChapter>[];
    if (isSeries) {
      chapters = parseEpisodes(html);
    } else {
      // 视频页：只在面包屑里找 /series/ 链接（相关推荐里的不算）
      final crumb = html.indexOf('<nav class="crumb"');
      if (crumb >= 0) {
        final hit = html.indexOf('href="/series/', crumb);
        if (hit >= 0 && hit < crumb + 2500) {
          final sUrl = absUrl(substringBefore(html.substring(hit + 6), '"'));
          final sHtml = await fetchSmart(sUrl, "series-episodes");
          chapters = parseEpisodes(sHtml);
        }
      }
    }

    if (chapters.isEmpty) {
      MChapter c = MChapter();
      c.name = title;
      c.url = url;
      c.thumbnailUrl = drama.imageUrl;
      chapters.add(c);
    }
    drama.chapters = chapters;
    return drama;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    final videos = <MVideo>[];
    final html = await fetchSmart(url, "data-hg-player");
    final hls = attrOf(html, 0, "data-hls");
    if (hls.isNotEmpty) {
      final full = absUrl(hls);
      final headers = {"Referer": "$baseUrl/"};
      videos.add(MVideo(full, "默认", full, headers: headers));
    }
    return videos;
  }

  @override
  Future<List<dynamic>> getPageList(String url) async {
    return [];
  }

  @override
  Future<String> getHtmlContent(String name, String url) async {
    return fetchSmart(url, "data-hg-player");
  }

  @override
  Future<String> cleanHtmlContent(String html) async {
    return html;
  }

  @override
  List<dynamic> getFilterList() {
    return [
      SelectFilter("Genre", "分类", 0, [
        SelectFilterOption("全部", ""),
        SelectFilterOption("MV/音乐剧", "1"),
        SelectFilterOption("短片", "2"),
        SelectFilterOption("连续剧", "3"),
        SelectFilterOption("片段", "4"),
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
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7",
  };
}

HuangGuo main(MSource source) {
  return HuangGuo(source: source);
}
