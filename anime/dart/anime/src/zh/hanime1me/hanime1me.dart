import 'package:mangayomi/bridge_lib.dart';

/// Hanime1.me（H動漫/裏番/線上看）— Mangayomi 動漫源
///
/// 列表：`/search?sort=最新上傳|最新上市|最多觀看&page=N`
///      分类：`/search?genre=裏番…&page=N`
///      搜索：`/search?query=關鍵詞&page=N`
/// 详情：`/watch?v=<id>`，页面内 `<source src="…-1080p.mp4?secure=…">` 直接给出多清晰度直链
///
/// 站点整站在 Cloudflare 后面。这里**不发送自定义 User-Agent**：应用在解开
/// CF 挑战后会把当时浏览器的 UA 存进设置，并在请求没有 UA 时自动补上；
/// 扩展硬塞一个桌面 UA 会让 cf_clearance 与 UA 对不上，从而一直 403。
/// 另外，HTTP 取到的页面若看不到目标内容，会自动改用应用内 WebView 再取一次。
class Hanime1Me extends MProvider {
  Hanime1Me({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  Future<String> fetch(String url) async {
    final res = await client.get(Uri.parse(url), headers: getHeader(baseUrl));
    return res.body;
  }

  /// 页面里的标题常带 HTML 实体（&amp; 最常见），转回可读字符
  String unescape(String s) {
    var out = s;
    out = out.replaceAll("&amp;", "&");
    out = out.replaceAll("&quot;", "\"");
    out = out.replaceAll("&#39;", "'");
    out = out.replaceAll("&#x27;", "'");
    out = out.replaceAll("&lt;", "<");
    out = out.replaceAll("&gt;", ">");
    out = out.replaceAll("&nbsp;", " ");
    return out.trim();
  }

  /// 页面是否仍是 Cloudflare 的挑战/拦截页（而不是真实内容）
  bool isChallenge(String body) {
    if (body.isEmpty) {
      return true;
    }
    if (body.contains("cf_chl_opt") ||
        body.contains("__cf_chl_tk") ||
        body.contains("Just a moment") ||
        body.contains("Attention Required") ||
        body.contains("cf-error-details") ||
        body.contains("Sorry, you have been blocked") ||
        body.contains("Enable JavaScript and cookies to continue")) {
      return true;
    }
    return false;
  }

  /// 应用内 WebView 取页：等 [marker] 出现（说明挑战已过、真实页面已渲染），
  /// 最多等 55 秒；超时也会把当前 HTML 返回，交由调用方判断。
  Future<String> fetchViaWebview(String url, String marker) async {
    final script =
        "(function(){var t=0;var iv=setInterval(function(){t++;"
        "var h=document.documentElement.outerHTML;"
        "if(h.indexOf('" +
        marker +
        "')!==-1||t>55){clearInterval(iv);"
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

  /// 先走 HTTP；看不到目标内容（被 CF 拦、或返回了空壳页）就用 WebView 重取。
  Future<String> fetchSmart(String url, String marker) async {
    String html = "";
    try {
      html = await fetch(url);
    } catch (e) {
      html = "";
    }
    if (html.isNotEmpty && html.contains(marker) && !isChallenge(html)) {
      return html;
    }
    final viaWebview = await fetchViaWebview(url, marker);
    if (viaWebview.isNotEmpty &&
        (viaWebview.contains(marker) || viaWebview.length > html.length)) {
      return viaWebview;
    }
    return html;
  }

  /// 解析列表：兼容站點兩套佈局（首頁/搜索用 .title，分類頁用 .home-rows-videos-title）
  Future<MPages> parseList(String url) async {
    final html = await fetchSmart(url, "/watch?v=");
    final list = <MManga>[];
    final marker = 'href="https://hanime1.me/watch?v=';
    int pos = 0;
    bool go = true;
    for (var n = 0; n < 80 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final href = substringBefore(html.substring(i + 6), '"');
        final end = (i + 1600 < html.length) ? i + 1600 : html.length;
        final win = html.substring(i, end);

        // 標題：兩種佈局各一個 class
        String title = "";
        var tIdx = win.indexOf('class="title"');
        final tAlt = win.indexOf("home-rows-videos-title");
        if (tIdx < 0 || (tAlt >= 0 && tAlt < tIdx)) {
          tIdx = tAlt;
        }
        if (tIdx >= 0) {
          final gt = win.indexOf(">", tIdx);
          if (gt >= 0) {
            title = unescape(substringBefore(win.substring(gt + 1), "<"));
          }
        }

        // 封面：條目內第一個 <img src="">
        String img = "";
        final imgIdx = win.indexOf("<img");
        if (imgIdx >= 0) {
          final sIdx = win.indexOf('src="', imgIdx);
          if (sIdx >= 0) {
            img = substringBefore(win.substring(sIdx + 5), '"');
          }
        }

        if (href.isNotEmpty && title.isNotEmpty) {
          MManga anime = MManga();
          anime.link = href;
          anime.name = title;
          anime.imageUrl = img;
          list.add(anime);
        }
      }
    }
    if (list.isEmpty) {
      return MPages(list, false);
    }
    return MPages(list, true);
  }

  String searchUrl(String query, String genre, String sort, int page) {
    var url = "$baseUrl/search?";
    if (query.isNotEmpty) {
      url = url + "query=" + Uri.encodeComponent(query) + "&";
    }
    if (genre.isNotEmpty) {
      url = url + "genre=" + Uri.encodeComponent(genre) + "&";
    }
    if (sort.isNotEmpty) {
      url = url + "sort=" + Uri.encodeComponent(sort) + "&";
    }
    return url + "page=$page";
  }

  @override
  Future<MPages> getPopular(int page) async {
    return parseList(searchUrl("", "", "最多觀看", page));
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    return parseList(searchUrl("", "", "最新上傳", page));
  }

  @override
  Future<MPages> search(String query, int page, FilterList filterList) async {
    String sort = "";
    String genre = "";
    for (var filter in filterList.filters) {
      if (filter.type == "Sort") {
        sort = filter.values[filter.state].value;
      } else if (filter.type == "Genre") {
        genre = filter.values[filter.state].value;
      }
    }
    return parseList(searchUrl(query, genre, sort, page));
  }

  @override
  Future<MManga> getDetail(String url) async {
    final html = await fetchSmart(url, 'property="og:title"');
    MManga anime = MManga();
    anime.link = url;

    String title = "";
    // 1) og:title 最稳
    final ogTitle = html.indexOf('property="og:title"');
    if (ogTitle >= 0) {
      final cIdx = html.indexOf('content="', ogTitle);
      if (cIdx >= 0) {
        title = substringBefore(html.substring(cIdx + 9), '"').trim();
      }
    }
    // 2) 页面内 class="video-title"
    if (title.isEmpty) {
      final tIdx = html.indexOf('class="video-title"');
      if (tIdx >= 0) {
        final gt = html.indexOf(">", tIdx);
        if (gt >= 0) {
          title = substringBefore(html.substring(gt + 1), "<").trim();
        }
      }
    }
    // 3) <title> 兜底
    if (title.isEmpty) {
      title = substringBefore(substringAfter(html, "<title>"), " - ").trim();
    }
    anime.name = unescape(title);

    final og = html.indexOf('property="og:image"');
    if (og >= 0) {
      final cIdx = html.indexOf('content="', og);
      if (cIdx >= 0) {
        anime.imageUrl = substringBefore(html.substring(cIdx + 9), '"');
      }
    }

    final genres = <String>[];
    var gPos = 0;
    for (var n = 0; n < 8; n++) {
      final i = html.indexOf('href="' + baseUrl + '/search?genre=', gPos);
      if (i < 0) {
        break;
      }
      gPos = i + 10;
      final rest = html.substring(gPos);
      final gt = rest.indexOf(">");
      if (gt >= 0) {
        final g = substringBefore(rest.substring(gt + 1), "<").trim();
        if (g.isNotEmpty && !genres.contains(g)) {
          genres.add(g);
        }
      }
    }
    anime.genre = genres;

    final chapters = <MChapter>[];
    MChapter episode = MChapter();
    episode.name = title;
    episode.url = url;
    episode.thumbnailUrl = anime.imageUrl;
    chapters.add(episode);
    anime.chapters = chapters;

    return anime;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    final videos = <MVideo>[];
    final html = await fetchSmart(url, "<source");

    final headers = {"Referer": "$baseUrl/"};
    var pos = 0;
    for (var n = 0; n < 12; n++) {
      final sIdx = html.indexOf("<source", pos);
      if (sIdx < 0) {
        break;
      }
      pos = sIdx + 7;
      final window = html.substring(
        sIdx,
        (sIdx + 600 < html.length) ? sIdx + 600 : html.length,
      );
      final srcIdx = window.indexOf('src="');
      if (srcIdx < 0) {
        continue;
      }
      final src = substringBefore(window.substring(srcIdx + 5), '"');
      if (src.isEmpty || !src.startsWith("http")) {
        continue;
      }
      String quality = "MP4";
      if (src.contains("-1080p")) {
        quality = "1080P";
      } else if (src.contains("-720p")) {
        quality = "720P";
      } else if (src.contains("-480p")) {
        quality = "480P";
      } else if (src.contains("-360p")) {
        quality = "360P";
      }
      videos.add(MVideo(src, quality, src, headers: headers));
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
      SelectFilter("Sort", "排序", 1, [
        SelectFilterOption("最新上傳", "最新上傳"),
        SelectFilterOption("最新上市", "最新上市"),
        SelectFilterOption("最多觀看", "最多觀看"),
      ]),
      SelectFilter("Genre", "分類", 0, [
        SelectFilterOption("全部", ""),
        SelectFilterOption("裏番", "裏番"),
        SelectFilterOption("泡麵番", "泡麵番"),
        SelectFilterOption("Motion Anime", "Motion Anime"),
        SelectFilterOption("3DCG", "3DCG"),
        SelectFilterOption("2.5D", "2.5D"),
        SelectFilterOption("2D動畫", "2D動畫"),
        SelectFilterOption("AI生成", "AI生成"),
        SelectFilterOption("MMD", "MMD"),
        SelectFilterOption("Cosplay", "Cosplay"),
        SelectFilterOption("新番預告", "新番預告"),
      ]),
    ];
  }

  @override
  List<dynamic> getSourcePreferences() {
    return [];
  }
}

/// 只带 Referer / Accept —— 不写 User-Agent，交给应用补（CF 挑战通过后应用会
/// 存下当时的浏览器 UA，cf_clearance 才能生效）。
Map<String, String> getHeader(String url) {
  return {
    "Referer": "$url/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7",
  };
}

Hanime1Me main(MSource source) {
  return Hanime1Me(source: source);
}
