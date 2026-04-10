Add-Type -Assembly System.IO.Compression.FileSystem
$docxPath = "C:\Users\nano\OneDrive\Documents\UCM\TFM\AI\cursor\funciones.docx"
$zip = [System.IO.Compression.ZipFile]::OpenRead($docxPath)
$entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" }
$reader = New-Object System.IO.StreamReader($entry.Open())
$content = $reader.ReadToEnd()
$reader.Close()
$zip.Dispose()
$content | Out-File -FilePath "C:\Users\nano\OneDrive\Documents\UCM\TFM\AI\cursor\document.xml" -Encoding UTF8
Write-Host "Done"
