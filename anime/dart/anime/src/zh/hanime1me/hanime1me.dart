import 'package:mangayomi/bridge_lib.dart';

/// Hanime1.me（H動漫/裏番/線上看）— Mangayomi 動漫源
///
/// 列表：`/search?sort=最新上傳|最新上市|最多觀看&page=N`
///      分类：`/search?genre=裏番…&page=N`
///      搜索：`/search?query=關鍵詞&page=N`
/// 详情：`/watch?v=<id>`，页面内 `<source src="…-1080p.mp4?secure=…">` 直接给出多清晰度直链
class Hanime1Me extends MProvider {
  Hanime1Me({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  String get ua =>
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  Future<String> fetch(String url, Map<String, String> headers) async {
    final res = await client.get(Uri.parse(url), headers: headers);
    return res.body;
  }

  /// 站點被 Cloudflare 挑戰時，退回應用內置的無頭 WebView 取頁
  Future<String> fetchPage(String url, Map<String, String> headers) async {
    final body = await fetch(url, headers);
    if (!isCloudflareChallenge(body)) {
      return body;
    }
    final viaWebview = await fetchViaWebview(url);
    if (viaWebview.isNotEmpty) {
      return viaWebview;
    }
    return body;
  }

  bool isCloudflareChallenge(String body) {
    return body.contains("cf_chl_opt") ||
        body.contains("Just a moment") ||
        body.contains("__cf_chl_tk");
  }

  Future<String> fetchViaWebview(String url) async {
    final script =
        "(function(){var t=0;var iv=setInterval(function(){t++;"
        "if(document.documentElement.outerHTML.indexOf('cf_chl_opt')===-1||t>40){"
        "clearInterval(iv);"
        "window.flutter_inappwebview.callHandler('setResponse',document.documentElement.outerHTML);"
        "}},1000);})()";
    try {
      final result = await evaluateJavascriptViaWebview(url, {}, [
        script,
      ], time: 60);
      return result == null ? "" : result.toString();
    } catch (e) {
      return "";
    }
  }

  /// 解析列表：兼容站點兩套佈局（首頁/搜索用 .title，分類頁用 .home-rows-videos-title）
  Future<MPages> parseList(String url) async {
    final html = await fetchPage(url, getHeader(baseUrl));
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
            title = substringBefore(win.substring(gt + 1), "<").trim();
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
      // 可能是 Cloudflare 挑戰未通過：返回空列表而非報錯
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
    final html = await fetchPage(url, getHeader(baseUrl));
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
    anime.name = title;

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
    final html = await fetchPage(url, getHeader(baseUrl));

    final headers = {"Referer": "$baseUrl/"};
    var pos = 0;
    for (var n = 0; n < 12; n++) {
      final sIdx = html.indexOf("<source", pos);
      if (sIdx < 0) {
        break;
      }
      pos = sIdx + 7;
      final window = html.substring(sIdx, (sIdx + 600 < html.length) ? sIdx + 600 : html.length);
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
    return fetch(url, getHeader(baseUrl));
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

Map<String, String> getHeader(String url) {
  return {
    "Referer": "$url/",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7",
  };
}

Hanime1Me main(MSource source) {
  return Hanime1Me(source: source);
}
