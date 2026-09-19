-- ============================================================
-- H動漫網 视频广告自动跳过（自定义按钮版，iOS / Android 通用）
--
-- 用法：Mangayomi → 设置 → 播放器 → 自定义按钮 → 新建
--   标题：去广告（随意）
--   启动脚本：粘贴下面「启动脚本开始/结束」之间的全部内容
--   按键脚本：填 -- adskip （必填，随便一句注释即可）
-- 保存后播放 H動漫網 视频，起播会直接跳过片头广告（约 26 秒），
-- 中途的广告段也会自动跳过。
--
-- 原理：扩展已把广告时间段标记在视频地址里（#adskip=0-26,459-485），
-- 这段 Lua 在播放时读取标记并自动 seek 跳过。
-- ============================================================

-- ---------- 启动脚本开始（从下面这行开始复制） ----------
local adskip_ranges, adskip_last = {}, 0
local function adskip_parse()
  adskip_ranges = {}
  local p = mp.get_property("path") or ""
  local i = p:find("#adskip=", 1, true)
  if not i then return end
  for part in p:sub(i + 8):gmatch("[^,]+") do
    local a, b = part:match("^(%d+)%-(%d+)$")
    if a then adskip_ranges[#adskip_ranges + 1] = { tonumber(a), tonumber(b) } end
  end
  if #adskip_ranges > 0 then
    mp.osd_message("检测到 " .. #adskip_ranges .. " 段广告，将自动跳过", 3)
  end
end
local function adskip_skip()
  if #adskip_ranges == 0 then return end
  local now = os.time()
  if now - adskip_last < 3 then return end
  local t = mp.get_property_number("time-pos")
  if not t then return end
  for _, r in ipairs(adskip_ranges) do
    if t >= r[1] - 1 and t < r[2] - 1 then
      adskip_last = now
      mp.commandv("seek", r[2], "absolute")
      return
    end
  end
end
mp.register_event("file-loaded", adskip_parse)
mp.observe_property("time-pos", "number", adskip_skip)
-- ---------- 启动脚本结束 ----------

