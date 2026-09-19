import 'package:mangayomi/bridge_lib.dart';

/// 爱丽丝书屋 alicesw.com — Mangayomi 小说源
///
/// 列表：分类 `/lists/<id>.html?page=N`；最新 `/all/order/update_time+desc.html?page=N`；
///      人气 `/all/order/hits+desc.html?page=N`；分类+排序 `/all/id/<id>/order/<field>+desc.html?page=N`
/// 搜索：`/search.html?q=<关键词>&f=_all&sort=relevance&p=<页>&serialize=`
/// 详情：`/novel/<id>.html`；全部章节 `/other/chapters/id/<id>.html`
/// 正文：`/book/<bookId>/<key>.html`，正文在 `<div class="read-content ...">` 里
class AliceSW extends MProvider {
  AliceSW({required this.source});

  MSource source;

  final Client client = Client();

  String get baseUrl => source.baseUrl ?? "";

  Future<String> fetch(String url) async {
    final res = await client.get(Uri.parse(url), headers: getHeader(baseUrl));
    return res.body;
  }

  // ---------- 通用小工具 ----------

  /// 去掉所有 `<...>` 标签
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

  String unescape(String s) {
    var out = s;
    out = out.replaceAll("&amp;", "&");
    out = out.replaceAll("&quot;", "\"");
    out = out.replaceAll("&#39;", "'");
    out = out.replaceAll("&#x27;", "'");
    out = out.replaceAll("&lt;", "<");
    out = out.replaceAll("&gt;", ">");
    out = out.replaceAll("&nbsp;", " ");
    out = out.replaceAll("&ldquo;", "\u201c");
    out = out.replaceAll("&rdquo;", "\u201d");
    out = out.replaceAll("&lsquo;", "\u2018");
    out = out.replaceAll("&rsquo;", "\u2019");
    out = out.replaceAll("&hellip;", "\u2026");
    out = out.replaceAll("&mdash;", "\u2014");
    out = out.replaceAll("&middot;", "\u00b7");
    out = out.replaceAll("&times;", "\u00d7");
    out = out.replaceAll("&laquo;", "\u00ab");
    out = out.replaceAll("&raquo;", "\u00bb");
    return out.trim();
  }

  String clean(String s) {
    return unescape(stripTags(s)).trim();
  }

  /// 去掉搜索结果标题里的序号前缀，如 "1. 书名"
  String stripIndex(String s) {
    var out = s;
    bool go = true;
    for (var n = 0; n < 4 && go; n++) {
      if (out.length > 0) {
        final c = out.substring(0, 1);
        if (c == "0" ||
            c == "1" ||
            c == "2" ||
            c == "3" ||
            c == "4" ||
            c == "5" ||
            c == "6" ||
            c == "7" ||
            c == "8" ||
            c == "9") {
          out = out.substring(1);
        } else {
          go = false;
        }
      } else {
        go = false;
      }
    }
    if (out.startsWith(".")) {
      out = out.substring(1);
    }
    return out.trim();
  }

  /// 取 href="..." 的值
  String attr(String s, int from, String name) {
    final marker = name + '="';
    final i = s.indexOf(marker, from);
    if (i < 0) {
      return "";
    }
    return substringBefore(s.substring(i + marker.length), '"');
  }

  // ---------- 列表解析 ----------

  /// 分类 / 最新 / 排行 页共用的一种列表：`<li class="two"><a href="/novel/xx.html">书名</a>`
  List<MManga> parseRecList(String html) {
    final list = <MManga>[];
    final marker = '<li class="two"><a href="';
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 120 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final href = substringBefore(html.substring(pos), '"');
        final gt = html.indexOf(">", pos);
        if (gt < 0) {
          go = false;
        } else {
          final name = clean(html.substring(gt + 1, html.indexOf("</a>", gt)));
          String author = "";
          final aIdx = html.indexOf('<li class="four">', gt);
          if (aIdx >= 0) {
            final aGt = html.indexOf(">", aIdx);
            final aEnd = html.indexOf("</li>", aIdx);
            if (aGt > 0 && aEnd > aGt) {
              author = clean(html.substring(aGt + 1, aEnd));
            }
          }
          if (href.contains("/novel/") && name.isNotEmpty) {
            MManga m = MManga();
            m.name = name;
            m.link = href.startsWith("http") ? href : (baseUrl + href);
            m.author = author;
            list.add(m);
          }
        }
      }
    }
    return list;
  }

  /// 搜索结果页：`<div class="list-group-item">` … `<h5><a href="/novel/xx.html">1. 书名</a>`
  List<MManga> parseSearchList(String html) {
    final list = <MManga>[];
    final marker = '<div class="list-group-item">';
    var pos = 0;
    bool go = true;
    for (var n = 0; n < 60 && go; n++) {
      final i = html.indexOf(marker, pos);
      if (i < 0) {
        go = false;
      } else {
        pos = i + marker.length;
        final linkIdx = html.indexOf('href="/novel/', pos);
        if (linkIdx < 0 || linkIdx > pos + 1500) {
          go = false;
        } else {
          final href = substringBefore(html.substring(linkIdx + 6), '"');
          final gt = html.indexOf(">", linkIdx);
          final endA = html.indexOf("</a>", gt + 1);
          String name = "";
          if (gt > 0 && endA > gt) {
            name = stripIndex(clean(html.substring(gt + 1, endA)));
          }
          String author = "";
          final aIdx = html.indexOf("作者：", gt);
          if (aIdx >= 0 && aIdx < pos + 1600) {
            final aGt = html.indexOf(">", aIdx);
            final aEnd = html.indexOf("</a>", aGt);
            if (aGt > 0 && aEnd > aGt) {
              author = clean(html.substring(aGt + 1, aEnd));
            }
          }
          if (name.isNotEmpty) {
            MManga m = MManga();
            m.name = name;
            m.link = href.startsWith("http") ? href : (baseUrl + href);
            m.author = author;
            list.add(m);
          }
        }
      }
    }
    return list;
  }

  bool hasNextPage(String html, int page) {
    final next = (page + 1).toString();
    return html.contains("page=" + next) || html.contains("&p=" + next) || html.contains("?p=" + next);
  }

  // ---------- 入口 ----------

  @override
  Future<MPages> getPopular(int page) async {
    final html = await fetch("$baseUrl/all/order/hits+desc.html?page=$page");
    return MPages(parseRecList(html), hasNextPage(html, page));
  }

  @override
  Future<MPages> getLatestUpdates(int page) async {
    final html = await fetch("$baseUrl/all/order/update_time+desc.html?page=$page");
    return MPages(parseRecList(html), hasNextPage(html, page));
  }

  @override
  Future<MPages> search(String query, int page, FilterList filterList) async {
    String genre = "";
    String sort = "update_time";
    for (var filter in filterList.filters) {
      if (filter.type == "Genre") {
        genre = filter.values[filter.state].value;
      } else if (filter.type == "Sort") {
        sort = filter.values[filter.state].value;
      }
    }
    if (query.isNotEmpty) {
      final q = Uri.encodeComponent(query);
      final html = await fetch(
        "$baseUrl/search.html?q=$q&f=_all&sort=relevance&p=$page&serialize=",
      );
      return MPages(parseSearchList(html), hasNextPage(html, page));
    }
    var url = "$baseUrl/all/order/" + sort + "+desc.html?page=$page";
    if (genre.isNotEmpty) {
      url = "$baseUrl/all/id/" + genre + "/order/" + sort + "+desc.html?page=$page";
    }
    final html = await fetch(url);
    return MPages(parseRecList(html), hasNextPage(html, page));
  }

  @override
  Future<MManga> getDetail(String url) async {
    try {
      return await buildDetail(url);
    } catch (e) {
      MManga err = MManga();
      err.link = url;
      err.name = "解析出错";
      err.description = "EXC " + e.toString();
      return err;
    }
  }

  Future<MManga> buildDetail(String url) async {
    final html = await fetch(url);
    MManga novel = MManga();
    novel.link = url;

    // 书名
    String name = "";
    final tIdx = html.indexOf('class="novel_title"');
    if (tIdx >= 0) {
      final gt = html.indexOf(">", tIdx);
      final end = html.indexOf("</div>", gt);
      if (gt > 0 && end > gt) {
        name = clean(html.substring(gt + 1, end));
      }
    }
    if (name.isEmpty) {
      name = substringBefore(substringAfter(html, "<title>"), "-").trim();
    }
    novel.name = name;

    // 封面：img 上同时有 src 与 data-src，取 class 之前最后出现的 src
    final cIdx = html.indexOf('class="lazyload_book_cover');
    if (cIdx > 0) {
      final head = html.substring((cIdx - 600 > 0) ? cIdx - 600 : 0, cIdx);
      final sIdx = head.lastIndexOf('src="');
      if (sIdx >= 0) {
        novel.imageUrl = substringBefore(head.substring(sIdx + 5), '"');
      }
    }

    // 作者 / 分类 / 状态 / 简介
    final aIdx = html.indexOf("作 者：");
    if (aIdx >= 0) {
      final gt = html.indexOf(">", aIdx);
      final end = html.indexOf("</a>", gt);
      if (gt > 0 && end > gt) {
        novel.author = clean(html.substring(gt + 1, end));
      }
    }
    final gIdx = html.indexOf("分 类：");
    if (gIdx >= 0) {
      final gt = html.indexOf(">", gIdx);
      final end = html.indexOf("</a>", gt);
      if (gt > 0 && end > gt) {
        final g = clean(html.substring(gt + 1, end));
        if (g.isNotEmpty) {
          novel.genre = [g];
        }
      }
    }
    final sIdx = html.indexOf("状 态：");
    if (sIdx >= 0) {
      final gt = html.indexOf(">", sIdx);
      final end = html.indexOf("<", gt + 1);
      if (gt > 0 && end > gt) {
        final st = clean(html.substring(gt + 1, end));
        if (st.contains("完结")) {
          novel.status = 1;
        } else if (st.contains("连载")) {
          novel.status = 0;
        }
      }
    }
    final dIdx = html.indexOf('class="jianjie"');
    if (dIdx >= 0) {
      final pIdx = html.indexOf("<p>", dIdx);
      final pEnd = html.indexOf("</p>", pIdx);
      if (pIdx > 0 && pEnd > pIdx) {
        novel.description = clean(html.substring(pIdx + 3, pEnd));
      }
    }

    // 全部章节
    final id = substringBefore(substringAfter(url, "/novel/"), ".");
    final chapters = <MChapter>[];
    if (id.isNotEmpty) {
      final lhtml = await fetch("$baseUrl/other/chapters/id/$id.html");
      final marker = 'href="/book/';
      var pos = 0;
      bool go = true;
      for (var n = 0; n < 3000 && go; n++) {
        final i = lhtml.indexOf(marker, pos);
        if (i < 0) {
          go = false;
        } else {
          pos = i + marker.length;
          final href = substringBefore(lhtml.substring(i + 6), '"');
          final gt = lhtml.indexOf(">", i);
          final end = lhtml.indexOf("</a>", gt);
          if (gt > 0 && end > gt) {
            final cname = clean(lhtml.substring(gt + 1, end));
            if (cname.isNotEmpty) {
              MChapter c = MChapter();
              c.name = cname;
              c.url = href.startsWith("http") ? href : (baseUrl + href);
              chapters.add(c);
            }
          }
        }
      }
    }
    novel.chapters = chapters;
    return novel;
  }

  @override
  Future<List<MVideo>> getVideoList(String url) async {
    return [];
  }

  @override
  Future<List<dynamic>> getPageList(String url) async {
    return [];
  }

  @override
  Future<String> getHtmlContent(String name, String url) async {
    final html = await fetch(url);
    return cleanHtmlContent(html);
  }

  /// 正文：取 `<div class="read-content ...">` 的内部 HTML
  @override
  Future<String> cleanHtmlContent(String html) async {
    String title = "";
    final tIdx = html.indexOf('class="j_chapterName"');
    if (tIdx >= 0) {
      final gt = html.indexOf(">", tIdx);
      final end = html.indexOf("</", gt);
      if (gt > 0 && end > gt) {
        title = clean(html.substring(gt + 1, end));
      }
    }
    if (title.isEmpty) {
      title = substringBefore(substringAfter(html, "<title>"), "_").trim();
    }

    final cIdx = html.indexOf('class="read-content');
    if (cIdx < 0) {
      return "";
    }
    final start = html.indexOf(">", cIdx);
    final end = html.indexOf("</div>", start);
    if (start < 0) {
      return "";
    }
    final body = (end > start) ? html.substring(start + 1, end) : html.substring(start + 1);

    // 去掉脚本/广告残留
    String cleaned = body;
    var p = 0;
    bool go = true;
    for (var n = 0; n < 200 && go; n++) {
      final s = cleaned.indexOf("<script", p);
      if (s < 0) {
        go = false;
      } else {
        final e = cleaned.indexOf("</script>", s);
        if (e < 0) {
          cleaned = cleaned.substring(0, s);
          go = false;
        } else {
          cleaned = cleaned.substring(0, s) + cleaned.substring(e + 9);
          p = s;
        }
      }
    }
    return cleaned;
  }

  @override
  List<dynamic> getFilterList() {
    return [
      SelectFilter("Genre", "分类", 0, [
        SelectFilterOption("全部", ""),
        SelectFilterOption("乱伦", "65"),
        SelectFilterOption("都市", "64"),
        SelectFilterOption("玄幻", "62"),
        SelectFilterOption("科幻", "71"),
        SelectFilterOption("奇幻", "75"),
        SelectFilterOption("武侠", "68"),
        SelectFilterOption("校园", "61"),
        SelectFilterOption("穿越", "70"),
        SelectFilterOption("系统", "69"),
        SelectFilterOption("同人", "73"),
        SelectFilterOption("乡村", "63"),
        SelectFilterOption("纯爱", "19"),
        SelectFilterOption("NTR", "54"),
        SelectFilterOption("调教", "58"),
        SelectFilterOption("凌辱", "46"),
        SelectFilterOption("堕落", "18"),
        SelectFilterOption("反差", "22"),
        SelectFilterOption("熟女", "56"),
        SelectFilterOption("萝莉", "48"),
        SelectFilterOption("正太", "50"),
        SelectFilterOption("伪娘", "52"),
        SelectFilterOption("百合", "47"),
        SelectFilterOption("耽美", "82"),
        SelectFilterOption("媚黑", "53"),
        SelectFilterOption("明星", "72"),
        SelectFilterOption("重口", "21"),
        SelectFilterOption("言情", "59"),
        SelectFilterOption("其他", "57"),
      ]),
      SelectFilter("Sort", "排序", 0, [
        SelectFilterOption("按更新", "update_time"),
        SelectFilterOption("按字数", "word"),
        SelectFilterOption("按人气", "hits"),
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

AliceSW main(MSource source) {
  return AliceSW(source: source);
}
