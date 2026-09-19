import 'package:mangayomi/bridge_lib.dart';

/// H動漫網 (https://www.hanime.xyz/) — Mangayomi 動漫源
///
/// 列表：`/?sort=id|hits|score|likes`、分頁 `&page=N`、搜索 `/?q=關鍵詞`
/// 詳情：`/<id>.html`，頁面內嵌 JSON-LD（VideoObject）含標題/封面/m3u8，無混淆
class HanimeXyz extends MProvider {
  HanimeXyz({required this.source});

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

  /// 解析列表（首頁/排序/搜索通用）：以縮略圖 <img class="card-img-top"> 定位每個條目
  Future<MPages> parseList(String url) async {
    final html = await fetchPage(url, getHeader(baseUrl));
    final list = <MManga>[];
    final marker = '<img class="card-img-top"';
    int pos = 0;
    bool go = true;
    for (var n = 0; n < 60 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;

        final before = html.substring(0, i);
        final hIdx = before.lastIndexOf('href="');
        String href = "";
        if (hIdx >= 0) {
          href = substringBefore(html.substring(hIdx + 6), '"');
        }
        if (href.startsWith("/")) {
          href = "$baseUrl$href";
        }

        String img = "";
        final sIdx = html.indexOf('src="', i);
        if (sIdx >= 0) {
          img = substringBefore(html.substring(sIdx + 5), '"');
        }

        String title = "";
        final aIdx = html.indexOf('alt="', i);
        if (aIdx >= 0) {
          title = substringBefore(html.substring(aIdx + 5), '"');
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

  @override
  Future<MPages> getPopular(int page) async {
    return parseList("$baseUrl/?sort=hits&page=$page");
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    return parseList("$baseUrl/?sort=id&page=$page");
  }

  @override
  Future<MPages> search(String query, int page, FilterList filterList) async {
    String sort = "id";
    for (var filter in filterList.filters) {
      if (filter.type == "Sort") {
        sort = filter.values[filter.state].value;
      }
    }
    String url = "$baseUrl/?sort=$sort&page=$page";
    if (query.isNotEmpty) {
      url = "$url&q=${Uri.encodeComponent(query)}";
    }
    return parseList(url);
  }

  @override
  Future<MManga> getDetail(String url) async {
    final html = await fetchPage(url, getHeader(baseUrl));
    MManga anime = MManga();
    anime.link = url;

    final ld = ldBlock(html);
    String title = unescapeJson(ldValue(ld, "name"));
    if (title.isEmpty) {
      title = substringBefore(substringAfter(html, "<title>"), " - ").trim();
    }
    anime.name = title;
    anime.description = unescapeJson(ldValue(ld, "description"));
    anime.imageUrl = unescapeJson(ldValue(ld, "thumbnailUrl"));

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

    final ld = ldBlock(html);
    String m3u8 = unescapeJson(ldValue(ld, "contentUrl"));
    if (m3u8.isEmpty) {
      // 回退：直接找 <source src="...m3u8">
      final i = html.indexOf('type="application/x-mpegURL"');
      if (i >= 0) {
        final before = html.substring(0, i);
        final sIdx = before.lastIndexOf('src="');
        if (sIdx >= 0) {
          m3u8 = substringBefore(html.substring(sIdx + 5), '"');
        }
      }
    }
    if (m3u8.isEmpty) {
      return videos;
    }

    final headers = {"Referer": "$baseUrl/"};
    // 在 URL 片段里标记广告时间段（如 #adskip=0-25.8,459.4-485.2），
    // 配合 mpv 脚本 adskip.js 实现自动跳过；脚本未安装时此标记对播放无影响
    final marked = await withAdSkipMarks(m3u8, headers);
    videos.add(MVideo(marked, "HLS", m3u8, headers: headers));
    return videos;
  }

  /// 分析播放列表，返回带 `#adskip=` 标记的 URL（广告分片與正片不在同一目錄即判定為廣告）
  Future<String> withAdSkipMarks(String masterUrl, Map<String, String> headers) async {
    final mediaUrl = await resolveMediaUrl(masterUrl, headers);
    if (mediaUrl.isEmpty) {
      return masterUrl;
    }
    final media = await fetch(mediaUrl, headers);
    if (!media.contains("#EXTINF")) {
      return masterUrl;
    }
    final root = contentRoot(mediaUrl);
    if (root.isEmpty) {
      return masterUrl;
    }

    final lines = media.split("\n");
    final marks = <String>[];
    var t = 0.0;
    var dur = 0.0;
    var adStart = -1.0;
    for (var i = 0; i < lines.length; i++) {
      final l = lines[i].trim();
      if (l.startsWith("#EXTINF:")) {
        final d = substringBefore(substringAfter(l, "#EXTINF:"), ",");
        dur = double.tryParse(d) ?? 0;
      } else if (l.isNotEmpty && !l.startsWith("#")) {
        final seg = absoluteUrl(mediaUrl, l);
        final isAd = !seg.startsWith(root);
        if (isAd && adStart < 0) {
          adStart = t;
        }
        if (!isAd && adStart >= 0) {
          marks.add(formatRange(adStart, t));
          adStart = -1;
        }
        t = t + dur;
      }
    }
    if (adStart >= 0) {
      marks.add(formatRange(adStart, t));
    }
    if (marks.isEmpty) {
      return masterUrl;
    }
    return masterUrl + "#adskip=" + marks.join(",");
  }

  String formatRange(double a, double b) {
    final ai = a.round();
    final bi = b.round();
    return ai.toString() + "-" + bi.toString();
  }

  /// master playlist → 媒體播放列表地址
  Future<String> resolveMediaUrl(String masterUrl, Map<String, String> headers) async {
    final master = await fetch(masterUrl, headers);
    if (master.contains("#EXTINF")) {
      return masterUrl;
    }
    String mediaUrl = "";
    if (master.contains("#EXTM3U")) {
      final lines = master.split("\n");
      for (var i = 0; i < lines.length; i++) {
        final l = lines[i].trim();
        if (mediaUrl.isEmpty && l.isNotEmpty && !l.startsWith("#")) {
          mediaUrl = absoluteUrl(masterUrl, l);
        }
      }
    }
    return mediaUrl;
  }

  /// 正片目錄（去掉最後三段）：https://h/a/b/c/d/hls/index.m3u8 → https://h/a/b/
  String contentRoot(String mediaUrl) {
    final i = mediaUrl.indexOf("://");
    if (i < 0) {
      return "";
    }
    final slash = mediaUrl.indexOf("/", i + 3);
    if (slash < 0) {
      return "";
    }
    final host = mediaUrl.substring(0, slash);
    final parts = mediaUrl.substring(slash).split("/");
    final keep = <String>[];
    for (var k = 0; k < parts.length - 3; k++) {
      keep.add(parts[k]);
    }
    return host + keep.join("/") + "/";
  }

  String absoluteUrl(String base, String url) {
    if (url.startsWith("http")) {
      return url;
    }
    final i = base.indexOf("://");
    if (i < 0) {
      return url;
    }
    final slash = base.indexOf("/", i + 3);
    if (slash < 0) {
      return url;
    }
    if (url.startsWith("/")) {
      return base.substring(0, slash) + url;
    }
    final lastSlash = base.lastIndexOf("/");
    return base.substring(0, lastSlash + 1) + url;
  }

  /// 取 JSON-LD (VideoObject) 區塊起點之後的內容
  String ldBlock(String html) {
    final i = html.indexOf("VideoObject");
    if (i < 0) {
      return "";
    }
    return html.substring(i);
  }

  /// 讀取 JSON 字串欄位（處理 \" 轉義）
  String ldValue(String block, String key) {
    final marker = '"' + key + '":"';
    final i = block.indexOf(marker);
    if (i < 0) {
      return "";
    }
    final rest = block.substring(i + marker.length);
    int end = -1;
    for (var j = 0; j < rest.length; j++) {
      if (rest.substring(j, j + 1) == '"' &&
          (j == 0 || rest.substring(j - 1, j) != "\\")) {
        end = j;
        break;
      }
    }
    if (end < 0) {
      return "";
    }
    return rest.substring(0, end);
  }

  /// 還原 JSON 字串轉義（\uXXXX、\/、\" 等）
  String unescapeJson(String s) {
    String out = "";
    int i = 0;
    while (i < s.length) {
      final ch = s.substring(i, i + 1);
      bool handled = false;
      if (ch == "\\" && i + 1 < s.length) {
        final n = s.substring(i + 1, i + 2);
        if (n == "u" && i + 6 <= s.length) {
          int v = 0;
          bool ok = true;
          for (var k = 0; k < 4; k++) {
            final d = hexDigit(s.codeUnitAt(i + 2 + k));
            if (d < 0) {
              ok = false;
            } else {
              v = v * 16 + d;
            }
          }
          if (ok) {
            out += String.fromCharCode(v);
            i += 6;
            handled = true;
          }
        }
        if (!handled) {
          out += n;
          i += 2;
          handled = true;
        }
      }
      if (!handled) {
        out += ch;
        i++;
      }
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
        SelectFilterOption("最新", "id"),
        SelectFilterOption("最多觀看", "hits"),
        SelectFilterOption("推薦", "score"),
        SelectFilterOption("好評", "likes"),
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

HanimeXyz main(MSource source) {
  return HanimeXyz(source: source);
}
