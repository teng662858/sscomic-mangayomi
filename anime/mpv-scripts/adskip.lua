-- adskip.lua — Mangayomi mpv 脚本：自动跳过扩展标记的广告时间段
--
-- 原理：扩展分析 HLS 播放列表后，把广告时间段以 URL 片段形式附在视频地址上，例如
--   https://.../index.m3u8#adskip=0-26,433-459
-- 本脚本读取该标记，播放进入广告区间时自动跳到区间末尾。
-- 没有该标记的其它来源视频完全不受影响。
--
-- 安装：把本文件放到手机的
--   /storage/emulated/0/Mangayomi/mpv/scripts/adskip.lua
-- 并确保 设置 → 播放器 → 高级 → 「启用 mpv 着色器/脚本」为开启状态。

local ranges = {}
local last_seek = 0

local function parse_skips()
  ranges = {}
  local path = mp.get_property("path") or ""
  local i = path:find("#adskip=", 1, true)
  if not i then
    return
  end
  local spec = path:sub(i + 8)
  for part in spec:gmatch("[^,]+") do
    local a, b = part:match("^(%d+)%-(%d+)$")
    if a and b then
      a = tonumber(a)
      b = tonumber(b)
      if a and b and b > a then
        ranges[#ranges + 1] = { a, b }
      end
    end
  end
  if #ranges > 0 then
    mp.osd_message("检测到 " .. #ranges .. " 段广告，将自动跳过", 3)
  end
end

local function skip_if_needed()
  if #ranges == 0 then
    return
  end
  local now = os.time()
  if now - last_seek < 3 then
    return
  end
  local t = mp.get_property_number("time-pos")
  if not t then
    return
  end
  for _, r in ipairs(ranges) do
    -- 留 1 秒余量，避免在区间边界反复触发
    if t >= r[1] - 1 and t < r[2] - 1 then
      last_seek = now
      mp.commandv("seek", r[2], "absolute")
      return
    end
  end
end

mp.register_event("file-loaded", parse_skips)
mp.observe_property("time-pos", "number", skip_if_needed)
