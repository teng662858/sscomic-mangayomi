import 'package:mangayomi/bridge_lib.dart';

/// 麻豆传媒AI（mdcmai4.xyz）— Mangayomi 动漫源
///
/// 站点是 Vite SPA，内容全走 JSON 接口（无需登录）：
///   列表 `/api/v1/videos?page=N&size=30[&categoryId=X]`
///   详情 `/api/v1/videos/<id>`
///   分类 `/api/v1/categories`（type=video 的才是视频分类）
///   封面 `/api/v1/image/proxy?path=...`（相对路径，需拼站点域名）
///   播放 `/api/v1/m3u8/proxy?path=<videoUrl>` —— 服务端把 m3u8 里的分片地址
///        改成带 auth_key 的 CDN 绝对地址，交给 mpv 直接播
/// 搜索接口需要登录（401），所以这个源没有搜索。
class MdcmAi extends MProvider {
  MdcmAi({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  Future<String> api(String path) async {
    final res = await client.get(Uri.parse("$baseUrl$path"), headers: {
      "Referer": "$baseUrl/",
      "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    return res.body;
  }

  // ---------- JSON 取值（纯字符串解析） ----------

  String jstr(String s, int from, String key) {
    final marker = '"' + key + '":"';
    final i = s.indexOf(marker, from);
    if (i < 0) {
      return "";
    }
    var p = i + marker.length;
    var buf = "";
    bool go = true;
    for (var n = 0; n < 4000 && go; n++) {
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
    var out = buf;
    out = out.replaceAll("\\u0026", "&");
    out = out.replaceAll("\\/", "/");
    out = out.replaceAll("\\\"", "\"");
    out = out.replaceAll("&amp;", "&");
    out = out.replaceAll("&#39;", "'");
    out = out.replaceAll("&quot;", "\"");
    out = out.replaceAll("&nbsp;", " ");
    out = out.replaceAll("&ldquo;", "\u201c");
    out = out.replaceAll("&rdquo;", "\u201d");
    out = out.replaceAll("&hellip;", "\u2026");
    return out.trim();
  }

  int jint(String s, int from, String key) {
    final marker = '"' + key + '":';
    final i = s.indexOf(marker, from);
    if (i < 0) {
      return 0;
    }
    final rest = s.substring(i + marker.length);
    var digits = "";
    var p = 0;
    bool go = true;
    for (var n = 0; n < 12 && go; n++) {
      if (p >= rest.length) {
        go = false;
      } else {
        final c = rest.substring(p, p + 1);
        if (c == "-" || (c.compareTo("0") >= 0 && c.compareTo("9") <= 0)) {
          digits = digits + c;
          p = p + 1;
        } else {
          go = false;
        }
      }
    }
    if (digits.isEmpty || digits == "-") {
      return 0;
    }
    return int.tryParse(digits) ?? 0;
  }

  String absUrl(String u) {
    if (u.isEmpty || u.startsWith("http")) {
      return u;
    }
    if (u.startsWith("/")) {
      return baseUrl + u;
    }
    return baseUrl + "/" + u;
  }

  /// 列表项：data.items 里每个对象取 id / title / coverUrl
  List<MManga> parseItems(String json) {
    final list = <MManga>[];
    final marker = '{"id":';
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 100 && go; n++) {
      final i = json.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final end = (i + 2500 < json.length) ? i + 2500 : json.length;
        final win = json.substring(i, end);
        final id = jint(win, 0, "id");
        final title = jstr(win, 0, "title");
        final cover = absUrl(jstr(win, 0, "coverUrl"));
        if (id > 0 && title.isNotEmpty) {
          MManga m = MManga();
          m.name = title;
          m.link = "$baseUrl/media/videos/$id";
          m.imageUrl = cover;
          list.add(m);
        }
      }
    }
    return list;
  }

  List<MManga> parseVideoList(String json) {
    final list = parseItems(json);
    final cat = jstr(json, 0, "categoryName");
    if (cat.isNotEmpty) {
      for (var m in list) {
        m.description = cat;
      }
    }
    return list;
  }

  String videoIdFromUrl(String url) {
    var u = url;
    if (u.endsWith("/")) {
      u = u.substring(0, u.length - 1);
    }
    final q = u.indexOf("?");
    if (q >= 0) {
      u = u.substring(0, q);
    }
    final i = u.lastIndexOf("/");
    if (i < 0) {
      return "";
    }
    return u.substring(i + 1);
  }

  // ---------- 入口 ----------

  Future<MPages> listPage(int page, String cat) async {
    var path = "/api/v1/videos?page=$page&size=30";
    if (cat.isNotEmpty) {
      path = path + "&categoryId=" + cat;
    }
    final json = await api(path);
    final list = parseVideoList(json);
    return MPages(list, list.length >= 30);
  }

  @override
  Future<MPages> getPopular(int page) async {
    return listPage(page, "");
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    return listPage(page, "");
  }

  @override
  Future<MPages> search(String query, int page, FilterList filterList) async {
    String cat = "";
    for (var filter in filterList.filters) {
      if (filter.type == "Genre") {
        cat = filter.values[filter.state].value;
      }
    }
    // 站点搜索接口需要登录，这里只按分类浏览
    return listPage(page, cat);
  }

  @override
  Future<MManga> getDetail(String url) async {
    MManga video = MManga();
    video.link = url;
    final id = videoIdFromUrl(url);
    if (id.isEmpty) {
      video.name = url;
      return video;
    }
    final json = await api("/api/v1/videos/$id");
    final title = jstr(json, 0, "title");
    video.name = title.isNotEmpty ? title : url;
    video.imageUrl = absUrl(jstr(json, 0, "coverUrl"));
    final desc = jstr(json, 0, "description");
    final cat = jstr(json, 0, "categoryName");
    final author = jstr(json, 0, "authorName");
    var d = "";
    if (desc.isNotEmpty) {
      d = desc;
    }
    if (cat.isNotEmpty) {
      d = d + "\n分类：" + cat;
    }
    if (author.isNotEmpty) {
      d = d + "\n作者：" + author;
    }
    video.description = d.trim();

    final chapters = <MChapter>[];
    MChapter c = MChapter();    c.name = video.name;
    c.url = url;
    c.thumbnailUrl = video.imageUrl;
    video.chapters.add(c);
    return video;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    final videos = <MVideo>[];
    final id = videoIdFromUrl(url);
    if (id.isEmpty) {
      return videos;
    }
    final json = await api("/api/v1/videos/$id");
    final raw = jstr(json, 0, "videoUrl");
    if (raw.isEmpty) {
      return videos;
    }
    final proxy =
        "$baseUrl/api/v1/m3u8/proxy?path=" + Uri.encodeComponent(raw);
    final headers = {"Referer": "$baseUrl/"};
    videos.add(MVideo(proxy, "默认", proxy, headers: headers));
    return videos;
  }

  @override
  Future<List<dynamic>> getPageList(String url) async {
    return [];
  }

  @override
  Future<String> getHtmlContent(String name, String url) async {
    return "";
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
        SelectFilterOption("国产自拍（最新更新）", "1"),
        SelectFilterOption("AV - 中文字幕", "2"),
        SelectFilterOption("探花大神", "4"),
        SelectFilterOption("麻豆原创AI", "6"),
        SelectFilterOption("91大神", "7"),
        SelectFilterOption("AV - 无码流出", "8"),
        SelectFilterOption("麻豆传媒", "9"),
        SelectFilterOption("麻豆x性吧联合原创", "10"),
        SelectFilterOption("清纯少女", "11"),
        SelectFilterOption("重口调教", "14"),
        SelectFilterOption("直播大秀", "15"),
        SelectFilterOption("网红主播", "16"),
        SelectFilterOption("媚黑母狗", "17"),
        SelectFilterOption("白虎少女", "18"),
        SelectFilterOption("黑料吃瓜", "19"),
        SelectFilterOption("破解偷拍", "20"),
        SelectFilterOption("反差母狗", "21"),
        SelectFilterOption("白虎嫩妹", "22"),
        SelectFilterOption("家庭乱伦", "23"),
        SelectFilterOption("熟女偷情", "24"),
        SelectFilterOption("网黄原创", "25"),
        SelectFilterOption("每日更新", "27"),
        SelectFilterOption("成人短剧", "29"),
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
    "Accept": "application/json, text/plain, */*",
  };
}

MdcmAi main(MSource source) {
  return MdcmAi(source: source);
}
