$sh = New-Object -ComObject WScript.Shell
$lnkPath = "$env:USERPROFILE\Desktop\SonoraMix.lnk"
if (Test-Path $lnkPath) {
    $lnk = $sh.CreateShortcut($lnkPath)
    Write-Host "Current Target:" $lnk.TargetPath
    Write-Host "Current IconLocation:" $lnk.IconLocation
    if (Test-Path $lnk.TargetPath) {
        $lnk.IconLocation = "$($lnk.TargetPath),0"
        $lnk.Save()
        Write-Host "Successfully updated IconLocation to:" $lnk.IconLocation
    }
}
