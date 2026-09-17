# 一条命令把 Mangayomi 源发布成 GitHub 仓库，并打印导入链接。
#
#   powershell -ExecutionPolicy Bypass -File publish.ps1
#   powershell -ExecutionPolicy Bypass -File publish.ps1 -Repo 其他名字 -Cdn raw
#   powershell -ExecutionPolicy Bypass -File publish.ps1 -Owner 你的用户名   # 已知用户名时可跳过查账号
#   powershell -ExecutionPolicy Bypass -File publish.ps1 -Token ghp_xxx      # 用 PAT，不弹登录窗
#   powershell -ExecutionPolicy Bypass -File publish.ps1 -SkipPush           # 只做本地提交，不联网
#
# 默认流程：弹出 GitHub 登录窗口 → 授权 → 自动建仓库 → 推送 → 打印导入链接。
# 仓库必须公开，Mangayomi 要能匿名拉取 index.json 和源码。

[CmdletBinding()]
param(
    [string]$Owner = "",
    [string]$Repo = "sscomic-mangayomi",
    [string]$Token = "",
    [string]$Branch = "main",
    # 参数名不能用 Host：$Host 是 PowerShell 的只读内置变量。
    [ValidateSet("pages", "raw", "jsdelivr")][string]$Cdn = "pages",
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# ---------------------------------------------------------------- 找 git / node
$git = ""
foreach ($c in @((Join-Path $here "..\_tools\git\cmd\git.exe"), (Join-Path $here "..\_tools\git\bin\git.exe"))) {
    if (Test-Path $c) { $git = (Resolve-Path $c).Path; break }
}
if (-not $git) {
    $onPath = Get-Command git -ErrorAction SilentlyContinue
    if ($onPath) { $git = $onPath.Source }
}
if (-not $git) { throw "找不到 git。先跑 ..\_tools\setup_git.ps1 安装便携版。" }
Write-Host "git : $git"

$node = ""
foreach ($c in @((Join-Path $here "..\_tools\node\node.exe"), "D:\Zcode\Breeze\.tools\node\node.exe")) {
    if (Test-Path $c) { $node = (Resolve-Path $c).Path; break }
}
if (-not $node) {
    $onPath = Get-Command node -ErrorAction SilentlyContinue
    if ($onPath) { $node = $onPath.Source }
}
if (-not $node) { throw "找不到 node。把 node.exe 放到 ..\_tools\node\ 下。" }
Write-Host "node: $node"

# ---------------------------------------------------------------- 取凭据
$apiHeaders = $null

if (-not $SkipPush) {
    if (-not $Token) {
        Write-Host ""
        Write-Host "== 获取 GitHub 凭据 =="
        Write-Host "接下来会弹出 GitHub 登录窗口（Git Credential Manager），点授权即可。"
        Write-Host "这一步只是为了拿到访问令牌，脚本不会把它写到仓库或打印出来。"
        # GCM 默认只在有终端时交互；脚本从管道里调用它，所以要显式要求它弹窗。
        $env:GCM_INTERACTIVE = "always"
        $env:GCM_GUI_PROMPT = "always"
        $payload = "protocol=https`nhost=github.com`n`n"
        $filled = $payload | & $git credential fill 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "没能拿到凭据（登录被取消或环境不支持弹窗）。"
            Write-Host "可以在 GitHub 上建一个 Personal Access Token（勾 repo 权限），然后："
            Write-Host "   powershell -ExecutionPolicy Bypass -File publish.ps1 -Owner 你的用户名 -Token ghp_xxx"
            exit 1
        }
        foreach ($line in $filled) {
            if ($line -like "password=*") { $Token = $line.Substring(9).Trim() }
            if (-not $Owner -and $line -like "username=*") { $Owner = $line.Substring(9).Trim() }
        }
        if (-not $Token) { throw "拿到的凭据里没有密码/令牌字段" }
        Write-Host "已获取令牌（长度 $($Token.Length)，不显示内容）"
    }

    $apiHeaders = @{
        Authorization          = "Bearer $Token"
        Accept                 = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }

    # 用令牌反查账号名，省得手填
    if (-not $Owner) {
        $me = Invoke-RestMethod -Method Get -Uri "https://api.github.com/user" -Headers $apiHeaders
        $Owner = $me.login
        Write-Host "GitHub 账号：$Owner"
    }
}

if (-not $Owner) { throw "没拿到 GitHub 用户名，请用 -Owner 指定。" }

# ---------------------------------------------------------------- 建仓库
if (-not $SkipPush) {
    Write-Host ""
    Write-Host "== 检查/创建远程仓库 $Owner/$Repo =="
    $exists = $true
    try {
        Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$Owner/$Repo" -Headers $apiHeaders | Out-Null
    } catch {
        $exists = $false
    }
    if ($exists) {
        Write-Host "仓库已存在，直接推送"
    } else {
        $body = @{
            name        = $Repo
            description = "sscomic.top 源（Mangayomi）"
            private     = $false
            has_issues  = $true
        } | ConvertTo-Json
        try {
            Invoke-RestMethod -Method Post -Uri "https://api.github.com/user/repos" -Headers $apiHeaders -Body $body -ContentType "application/json" | Out-Null
            Write-Host "已创建公开仓库：$Owner/$Repo"
        } catch {
            Write-Host ""
            Write-Host "自动建仓库失败：$($_.Exception.Message)"
            Write-Host "令牌可能没有 repo 权限。请手动建一个空仓库（不要勾 README）："
            Write-Host "   https://github.com/new?name=$Repo"
            Write-Host "建好后重新跑本脚本即可（这次会直接推送）。"
            exit 1
        }
    }
}

# ---------------------------------------------------------------- 写地址（必须在提交之前）
Write-Host ""
Write-Host "== 写入仓库地址到 index.json =="
& $node (Join-Path $here "tools\configure.mjs") --owner $Owner --repo $Repo --branch $Branch --host $Cdn
if ($LASTEXITCODE -ne 0) { throw "configure.mjs 执行失败" }

Write-Host ""
Write-Host "== 发布前自检 =="
& $node (Join-Path $here "..\_tools\check_mangayomi_index.cjs")
if ($LASTEXITCODE -ne 0) { throw "自检未通过，已中止（先修好 index.json 再发布）" }

# ---------------------------------------------------------------- 本地提交
Write-Host ""
Write-Host "== 准备本地提交 =="
if (-not (Test-Path (Join-Path $here ".git"))) {
    & $git init --initial-branch=$Branch | Out-Null
}
# 提交者身份用 GitHub 的 noreply 邮箱，不暴露真实邮箱。
& $git config user.name $Owner
& $git config user.email "$Owner@users.noreply.github.com"

& $git add -A
$pending = & $git status --porcelain
if ($pending) {
    & $git commit -m "sscomic.top source for Mangayomi" | Out-Null
    Write-Host ("已提交 " + ($pending | Measure-Object).Count + " 处改动")
} else {
    Write-Host "没有需要提交的改动"
}

if ($SkipPush) {
    Write-Host ""
    Write-Host "-SkipPush：只做了本地提交，没有联网。"
    exit 0
}

# ---------------------------------------------------------------- 推送
Write-Host ""
Write-Host "== 推送 =="
$cleanUrl = "https://github.com/$Owner/$Repo.git"
$authUrl = "https://$Owner`:$Token@github.com/$Owner/$Repo.git"

if ((& $git remote) -contains "origin") {
    & $git remote set-url origin $authUrl
} else {
    & $git remote add origin $authUrl
}
try {
    & $git push -u origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "git push 返回 $LASTEXITCODE" }
} finally {
    # 不要把令牌留在 .git/config 里；之后 GCM 会自己带上凭据。
    & $git remote set-url origin $cleanUrl
}

# ---------------------------------------------------------------- 打完收工
& $git remote -v
Write-Host ""
Write-Host "== 完成，下面是 App 里的导入方式 =="
& $node (Join-Path $here "tools\configure.mjs") --owner $Owner --repo $Repo --branch $Branch --host $Cdn --dry-run

if ($Cdn -eq "pages") {
    Write-Host ""
    Write-Host "提醒：用 GitHub Pages 托管的话，去仓库 Settings → Pages 把 Source 设为 Deploy from a branch / $Branch / root，等一两分钟生效。"
}
