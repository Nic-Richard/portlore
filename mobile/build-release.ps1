param(
    [string]$KeyDirectory = (Join-Path $PSScriptRoot '..\..\keys')
)

$ErrorActionPreference = 'Stop'
$keyPath = Join-Path $KeyDirectory 'portlore-upload.p12'
$passwordPath = Join-Path $KeyDirectory 'upload-password.xml'
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) {
    throw 'The upload key and encrypted password must exist outside the repo.'
}

$savedKeyPath = $env:PORTLORE_KEYSTORE_PATH
$savedPassword = $env:PORTLORE_KEYSTORE_PASSWORD
Push-Location $PSScriptRoot
try {
    & npm.cmd run sync
    if ($LASTEXITCODE -ne 0) { throw 'Client sync failed.' }

    $credential = Import-Clixml -LiteralPath $passwordPath
    $env:PORTLORE_KEYSTORE_PATH = (Resolve-Path -LiteralPath $keyPath).Path
    $env:PORTLORE_KEYSTORE_PASSWORD = $credential.GetNetworkCredential().Password
    Push-Location (Join-Path $PSScriptRoot 'android')
    try {
        & .\gradlew.bat --no-daemon bundleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Release bundle build failed.' }
    } finally {
        Pop-Location
    }
} finally {
    $env:PORTLORE_KEYSTORE_PATH = $savedKeyPath
    $env:PORTLORE_KEYSTORE_PASSWORD = $savedPassword
    $credential = $null
    Pop-Location
}
