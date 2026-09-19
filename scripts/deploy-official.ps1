# Publish dist-official/ (static official site) to the hosting repo (GitHub Pages + custom domain).
# Usage: npm run build:official, then: powershell -File scripts/deploy-official.ps1
# The hosting repo only holds built static files (source: src/officialSite/ in this repo). Never force-pushes.
param([string]$Repo = '1125naoto/michinoekinavi-site')
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$src = Join-Path $root 'dist-official'
if (-not (Test-Path (Join-Path $src 'index.html'))) { throw 'dist-official not found. Run npm run build:official first.' }
$sha = (git -C $root rev-parse --short HEAD)
$work = Join-Path $env:TEMP ('official-deploy-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
git clone --quiet "https://github.com/$Repo.git" $work
Get-ChildItem $work -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
Copy-Item (Join-Path $src '*') $work -Recurse -Force
Copy-Item (Join-Path $src '.nojekyll') $work -Force
Set-Location $work
git add -A
if (git status --porcelain) {
  git commit --quiet -m "Update official site (source commit $sha)"
  git push --quiet origin HEAD:main
  Write-Host ("pushed: " + (git rev-parse --short HEAD))
} else { Write-Host 'no changes' }
Set-Location $root
