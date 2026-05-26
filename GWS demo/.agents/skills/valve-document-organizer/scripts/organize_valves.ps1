$source = 'C:\Users\GaryTzeng\OneDrive - 富迪斯股份有限公司\工作文件\AntiGary\GWS demo\reference valve doc'
$targetRoot = 'C:\Users\GaryTzeng\OneDrive - 富迪斯股份有限公司\工作文件\AntiGary\GWS demo\organized'

if (-not (Test-Path $source)) {
    Write-Output '來源目錄不存在'
    exit
}

$files = Get-ChildItem -Path $source -Filter '*.pdf'

if ($files.Count -eq 0) {
    Write-Output '沒有找到需要分類的 PDF 檔案。'
    exit
}

$summary = @()

foreach ($file in $files) {
    if ($file.Name -match 'BHMN') {
        $brand = 'BHMN'
        $type = 'General Valve'
        
        if ($file.Name -match '49000|VLOG') {
            $type = 'Engineering Valve'
        } elseif ($file.Name -match '51-52-53|87.*88|Act') {
            $type = 'Actuator'
        } elseif ($file.Name -match '21000|41005') {
            $type = 'General Valve'
        }

        $category = 'TS'
        if ($file.Name -match '-BR-') {
            $category = 'BR'
        }

        $destFolder = [System.IO.Path]::Combine($targetRoot, $brand, $type, $category)
        if (-not (Test-Path $destFolder)) {
            New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
        }

        $destPath = [System.IO.Path]::Combine($destFolder, $file.Name)
        Move-Item -Path $file.FullName -Destination $destPath -Force
        
        $summary += [PSCustomObject]@{
            FileName = $file.Name
            Type     = $type
            Category = $category
        }
    }
}

$summary | Format-Table -AutoSize