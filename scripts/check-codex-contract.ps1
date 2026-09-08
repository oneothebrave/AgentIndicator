$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$schema = Join-Path $repo '.tmp/contract-schema'
codex app-server generate-ts --out $schema
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$contract = Get-Content -LiteralPath (Join-Path $repo 'server/sources/codex/contract.ts') -Raw
foreach ($name in @('TurnStatus', 'ThreadActiveFlag')) {
  $generated = Get-Content -LiteralPath (Join-Path $schema "v2/$name.ts") -Raw
  $pattern = "export type $name = ([^;]+);"
  $actual = [regex]::Match($generated, $pattern).Groups[1].Value.Trim()
  $expected = [regex]::Match($contract, $pattern).Groups[1].Value.Trim()
  if (-not $actual -or $actual -ne $expected) { throw "Codex contract changed: $name. Review mapping and fixtures before upgrading." }
}
Write-Output 'Codex contract matches installed app-server schema.'
