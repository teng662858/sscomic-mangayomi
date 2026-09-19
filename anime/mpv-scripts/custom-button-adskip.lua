-- ============================================================
-- H動漫網 视频广告自动跳过（自定义按钮版，iOS / Android 通用）
--
-- 用法：Mangayomi → 设置 → 播放器 → 自定义按钮 → 新建
--   按钮文本：去广告（随意）
--   lua 代码：填  -- adskip    （必填，随便一句注释即可）
--   lua 代码（启动时）：粘贴本文件「启动代码」以下的全部内容
--
-- 效果：打开视频即跳到 26 秒处开始放正片（片头广告不播，无需等待），
--       播放中约 7:39 处的中插广告也会自动跳过。
--
-- 原理：扩展已把广告时间段标注在视频地址里（#adskip=0-26,459-485），
-- 这段 Lua 在加载/播放时读取标记并 seek 跳过。
-- ============================================================

-- ---------- 启动代码（从下面这行开始复制） ----------
local adskip_ranges, adskip_last = {}, 0

local function adskip_parse()
  adskip_ranges = {}
  local p = mp.get_property("path") or ""
  local i = p:find("#adskip=", 1, true)
  if not i then
    return
  end
  for part in p:sub(i + 8):gmatch("[^,]+") do
    local a, b = part:match("^(%d+)%-(%d+)$")
    if a then
      adskip_ranges[#adskip_ranges + 1] = { tonumber(a), tonumber(b) }
    end
  end
  if #adskip_ranges > 0 then
    mp.osd_message("检测到 " .. #adskip_ranges .. " 段广告，将自动跳过", 3)
  end
end

-- 片头：加载完成即跳到第一段广告结束处，正片马上开始
local function adskip_seek_start()
  if #adskip_ranges > 0 and adskip_ranges[1][1] <= 2 then
    adskip_last = os.time()
    mp.commandv("seek", adskip_ranges[1][2], "absolute")
  end
end

-- 中插：播放进入广告区间时跳到区间末尾
local function adskip_watch()
  if #adskip_ranges == 0 then
    return
  end
  local now = os.time()
  if now - adskip_last < 3 then
    return
  end
  local t = mp.get_property_number("time-pos")
  if not t then
    return
  end
  for _, r in ipairs(adskip_ranges) do
    if t >= r[1] - 1 and t < r[2] - 1 then
      adskip_last = now
      mp.commandv("seek", r[2], "absolute")
      return
    end
  end
end

mp.register_event("file-loaded", function()
  adskip_parse()
  adskip_seek_start()
end)
mp.observe_property("time-pos", "number", adskip_watch)
-- ---------- 启动代码结束 ----------
