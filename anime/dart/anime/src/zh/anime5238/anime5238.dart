import 'package:mangayomi/bridge_lib.dart';

/// 5238動漫 (https://www.5238.me/) — Mangayomi 動漫源
///
/// 每個視頻貼文作為一部「動漫」、內含單一集數。
/// 播放鏈路：詳情頁 iframe -> video.520cc.cc player -> get3G.php（字符偏移混淆）-> m3u8 / mp4
class Anime5238 extends MProvider {
  Anime5238({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  String get ua =>
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  /// 播放器主機（video.520cc.cc / mm.520cc.cc）會校驗 Referer，統一用站點域名
  String get siteReferer => "https://www.5238.me/";

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
    // 挑戰頁會先加載，輪詢等待 Cloudflare 驗證通過（頁面不再是挑戰頁）後再回傳
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

  /// 解析列表頁（首頁 / 分類頁 / 搜索頁通用）
  Future<MPages> parseList(String url) async {
    final html = await fetchPage(url, getHeader(baseUrl));
    final urls = xpath(html, '//a[@id="preview_image"]/@href') ?? [];
    final titles = xpath(html, '//a[@id="preview_image"]/@title') ?? [];
    final images = xpath(html, '//a[@id="preview_image"]/img/@src') ?? [];

    final list = <MManga>[];
    for (var i = 0; i < urls.length; i++) {
      if (i >= titles.length || i >= images.length) {
        break;
      }
      MManga anime = MManga();
      anime.link = urls[i];
      anime.name = titles[i];
      anime.imageUrl = images[i];
      list.add(anime);
    }
    if (list.isEmpty) {
      // 可能是 Cloudflare 挑戰未通過：返回空列表而非報錯
      return MPages(list, false);
    }
    return MPages(list, urls.length > 0);
  }

  @override
  Future<MPages> getPopular(int page) async {
    return parseList("$baseUrl/page/$page?order=views");
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    return parseList("$baseUrl/page/$page?order=newest");
  }

  @override
  Future<MPages> search(String query, int page, FilterList filterList) async {
    String order = "newest";
    String category = "";
    for (var filter in filterList.filters) {
      if (filter.type == "Sort") {
        order = filter.values[filter.state].value;
      } else if (filter.type == "Category") {
        category = filter.values[filter.state].value;
      }
    }

    String url;
    if (query.isNotEmpty) {
      url = "$baseUrl/?s=${Uri.encodeComponent(query)}";
      if (page > 1) {
        url = "$url&paged=$page";
      }
      if (order != "newest") {
        url = "$url&order=$order";
      }
    } else if (category.isNotEmpty) {
      url = "$baseUrl/category/$category/page/$page";
      if (order != "newest") {
        url = "$url?order=$order";
      }
    } else {
      url = "$baseUrl/page/$page";
      if (order != "newest") {
        url = "$url?order=$order";
      }
    }
    return parseList(url);
  }

  @override
  Future<MManga> getDetail(String url) async {
    final html = await fetchPage(url, getHeader(baseUrl));
    MManga anime = MManga();
    anime.link = url;

    String title = "";
    final h1Start = html.indexOf('<h1 class="singletitle');
    if (h1Start >= 0) {
      title = substringAfter(html.substring(h1Start), ">");
      title = substringBefore(title, "</h1>").trim();
    }
    if (title.isEmpty) {
      title = substringAfter(html, "<title>");
      title = substringBefore(title, "&#8211;");
      title = title.trim();
    }
    anime.name = title;

    final thumbs = xpath(html, '//img[contains(@class, "wp-post-image")]/@src') ?? [];
    final thumb = thumbs.isNotEmpty ? thumbs.first : "";
    anime.imageUrl = thumb;

    final chapters = <MChapter>[];
    MChapter episode = MChapter();
    episode.name = title;
    episode.url = url;
    episode.thumbnailUrl = thumb;
    chapters.add(episode);
    anime.chapters = chapters;

    return anime;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    final videos = <MVideo>[];

    // 1) 詳情頁 -> 播放器 iframe（站點會輪換播放器域名，統一按 player5238 匹配）
    final html = await fetchPage(url, getHeader(baseUrl));
    final playerUrl = extractPlayerUrl(html);
    if (playerUrl.isEmpty) {
      return videos;
    }

    // 2) 播放器頁 -> 取視頻接口地址（播放器主機會校驗 Referer，需用站點域名）
    final playerHtml = await fetch(playerUrl, {
      "Referer": siteReferer,
      "User-Agent": ua,
    });
    final origin = substringBeforeLast(playerUrl, "/");

    // 形態 A：player5238G.php -> get3G.php（字符偏移混淆，mp4=0/1 兩種模式）
    if (playerHtml.contains('"get3G.php?')) {
      String q = substringAfter(playerHtml, '"get3G.php?');
      q = substringBefore(q, '"');
      if (q.isEmpty) {
        return videos;
      }
      final base = "$origin/get3G.php?$q";
      final m3u8 = decodePayload(
        await fetch("${base}0", {"Referer": playerUrl, "User-Agent": ua}),
        "m3u8",
      );
      if (m3u8.isNotEmpty) {
        videos.add(MVideo(m3u8, "HLS", m3u8, headers: {"Referer": playerUrl}));
      }
      final mp4 = decodePayload(
        await fetch("${base}1", {"Referer": playerUrl, "User-Agent": ua}),
        "mp4",
      );
      if (mp4.isNotEmpty) {
        videos.add(MVideo(mp4, "MP4", mp4, headers: {"Referer": playerUrl}));
      }
      return videos;
    }

    // 形態 B：mm.520cc.cc/api/player5238.php -> get3.php（明文返回）
    if (playerHtml.contains('"get3.php?')) {
      String q = substringAfter(playerHtml, '"get3.php?');
      q = substringBefore(q, '"');
      if (q.isEmpty) {
        return videos;
      }
      final body = await fetch("$origin/get3.php?$q", {
        "Referer": playerUrl,
        "User-Agent": ua,
      });
      final m3u8 = decodePayload(body, "m3u8");
      if (m3u8.isNotEmpty) {
        videos.add(MVideo(m3u8, "HLS", m3u8, headers: {"Referer": playerUrl}));
      }
      final mp4 = decodePayload(body, "mp4");
      if (mp4.isNotEmpty) {
        videos.add(MVideo(mp4, "MP4", mp4, headers: {"Referer": playerUrl}));
      }
    }

    return videos;
  }

  /// 提取播放器 iframe 地址（站點會輪換播放器域名：video.520cc.cc/player5238G.php
  /// 或 mm.520cc.cc/api/player5238.php，統一按 player5238 定位）
  String extractPlayerUrl(String html) {
    final wrapIdx = html.indexOf("player_wrapper");
    final idx = html.indexOf("player5238", wrapIdx >= 0 ? wrapIdx : 0);
    if (idx < 0) {
      return "";
    }
    final before = html.substring(0, idx);
    final srcIdx = before.lastIndexOf('src="');
    if (srcIdx < 0) {
      return "";
    }
    final rest = html.substring(srcIdx + 5);
    final end = rest.indexOf('"');
    if (end < 0) {
      return "";
    }
    return rest.substring(0, end);
  }

  /// 解碼播放接口返回（形態 A 為字符偏移混淆，形態 B 為明文）
  String decodePayload(String body, String ext) {
    if (!body.contains("ccsJsCmds") || !body.contains("myencryptHTML")) {
      return extractUrl(body, ext);
    }
    String cmds = substringAfter(body, "ccsJsCmds = '");
    cmds = substringBefore(cmds, "'");
    String outer = substringAfter(body, "myencryptHTML('");
    outer = substringBefore(outer, "'");
    if (cmds.isEmpty || outer.isEmpty) {
      return "";
    }
    final shift = findShift(outer);
    final js = unescape(decodeShift(cmds, shift));
    return extractUrl(js, ext);
  }

  /// 網站隨機使用 1..6 層 myencryptHTML（字符碼 -1），以還原後以 eval 開頭者為準
  int findShift(String outer) {
    for (var n = 1; n <= 6; n++) {
      if (decodeShift(outer, n).startsWith("eval")) {
        return n;
      }
    }
    return 1;
  }

  /// myencryptHTML 反向解碼：charCode >= 8364 歸為 128，再減去偏移
  String decodeShift(String s, int shift) {
    String out = "";
    for (var j = 0; j < s.length; j++) {
      int n = s.codeUnitAt(j);
      if (n >= 8364) {
        n = 128;
      }
      out += String.fromCharCode(n - shift);
    }
    return out;
  }

  /// 相當於 JS 的 unescape()：百分號解碼
  String unescape(String s) {
    String out = "";
    int i = 0;
    while (i < s.length) {
      if (s.substring(i, i + 1) == "%" && i + 2 < s.length) {
        final h1 = s.codeUnitAt(i + 1);
        final h2 = s.codeUnitAt(i + 2);
        final d1 = hexDigit(h1);
        final d2 = hexDigit(h2);
        if (d1 >= 0 && d2 >= 0) {
          out += String.fromCharCode(d1 * 16 + d2);
          i += 3;
          continue;
        }
      }
      out += s.substring(i, i + 1);
      i++;
    }
    return out;
  }

  int hexDigit(int c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    if (c >= 65 && c <= 70) {
      return c - 55;
    }
    if (c >= 97 && c <= 102) {
      return c - 87;
    }
    return -1;
  }

  /// 從解碼後的 JS 中取出以 https 開頭、以擴展名結尾的地址
  /// （JS 字符串轉義會在地址後留下 \"，故遇 \ 即截斷）
  String extractUrl(String js, String ext) {
    final marker = ".$ext";
    final i = js.indexOf(marker);
    if (i < 0) {
      return "";
    }
    int s = i;
    while (s > 0 && js.substring(s - 1, s) != '"') {
      s--;
    }
    int e = js.indexOf('"', i);
    if (e < 0) {
      e = js.length;
    }
    final u = substringBefore(js.substring(s, e), "\\");
    if (u.startsWith("https") || u.startsWith("http")) {
      return u;
    }
    return "";
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
      SelectFilter("Sort", "排序", 0, [
        SelectFilterOption("最新", "newest"),
        SelectFilterOption("最多人看", "views"),
        SelectFilterOption("評分", "rate"),
        SelectFilterOption("討論", "discussed"),
      ]),
      SelectFilter("Category", "分類", 0, [
        SelectFilterOption("全部", ""),
        SelectFilterOption("有碼", "%e6%9c%89%e7%a2%bc"),
        SelectFilterOption("無碼", "%e7%84%a1%e7%a2%bc"),
        SelectFilterOption("不分類", "%e4%b8%8d%e5%88%86%e9%a1%9e"),
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

Anime5238 main(MSource source) {
  return Anime5238(source: source);
}
