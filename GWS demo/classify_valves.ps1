# 使用相對路徑避免 Windows 檔案系統編碼解析錯誤
$sourceDir = Join-Path $PSScriptRoot "reference valve doc"
$targetDir = Join-Path $PSScriptRoot "organized"

if (-not (Test-Path -LiteralPath $sourceDir)) {
    Write-Host "Source directory not found! ($sourceDir)" -ForegroundColor Red
    exit
}

# 取得檔案清單
$files = Get-ChildItem -LiteralPath $sourceDir -Filter *.pdf

foreach ($f in $files) {
    $name = $f.Name
    $type = "General Valve"
    $cat = "Brochure - Catalogue"
    
    # 1. 類型 (Type) 分類
    if ($name -match "(51-52-53|87.*88|Act)") {
        $type = "Actuator"
    } elseif ($name -match "(49000|VLOG)") {
        $type = "Engineering Valve"
    } elseif ($name -match "(21000|41005)") {
        $type = "General Valve"
    }
    
    # 2. 類別 (Category) 分類
    if ($name -match "(-IOM-|-TS-)") {
        $cat = "Technical Specification"
    } elseif ($name -match "-BR-") {
        $cat = "Brochure - Catalogue"
    }
    
    # 建立目標目錄路徑
    $destSub = "BHMN/$type/$cat"
    $destPath = Join-Path $targetDir $destSub
    
    if (-not (Test-Path -LiteralPath $destPath)) {
        # New-Item 在舊版 PowerShell 可能不支援 -LiteralPath
        New-Item -ItemType Directory -Path $destPath -Force | Out-Null
        Write-Host "Created Directory: $destSub" -ForegroundColor Yellow
    }
    
    # 執行複製
    Copy-Item -LiteralPath $f.FullName -Destination $destPath -Force
    Write-Host "Copied ✅ : $name -> $destSub" -ForegroundColor Green
}

Write-Host "Classification complete!" -ForegroundColor Cyan
