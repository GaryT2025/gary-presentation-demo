# 使用相對路徑避免 Windows 檔案系統編碼解析錯誤
$sourceDir = Join-Path $PSScriptRoot "reference valve doc"
$targetDir = Join-Path $PSScriptRoot "organized"

if (-not (Test-Path -LiteralPath $sourceDir)) {
    Write-Host "Source directory not found! ($sourceDir)" -ForegroundColor Red
    exit
}

$files = Get-ChildItem -LiteralPath $sourceDir -Filter *.pdf
$results = @()

foreach ($f in $files) {
    $name = $f.Name
    $type = "General Valve"
    $cat = "Brochure - Catalogue"
    $brand = "BHMN" 
    
    # 1. 類型 (Type) 分類
    if ($name -match "(51-52-53|87.*88|Act)") {
        $type = "Actuator"
    } elseif ($name -match "(49000|VLOG)") {
        $type = "Engineering Valve"
    } elseif ($name -match "(21000|41005)") {
        $type = "General Valve"
    }
    
    # 2. 類別 (Category) 分類
    if ($name -match "(-IOM-)") {
        $cat = "IOM"
    } elseif ($name -match "(-TS-)") {
        $cat = "Technical Specification"
    } elseif ($name -match "(-BR-)") {
        $cat = "Brochure"
    }
    
    if ($name -match "^([A-Z0-9a-z]+)-") {
        $brand = $Matches[1]
    }

    $destSub = "$brand/$type/$cat"
    
    $results += [PSCustomObject]@{
        "Original_Filename" = $name
        "Brand"             = $brand
        "Type"              = $type
        "Category"          = $cat
        "Destination_Sub"   = $destSub
    }
}

$results | ConvertTo-Json -Depth 3 | Out-File -FilePath (Join-Path $PSScriptRoot "dry_run_output.json") -Encoding UTF8
Write-Host "Done"
