$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$schema = Join-Path $repo '.tmp/contract-schema'
codex app-server generate-ts --out $schema
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
$contract = Get-Content -LiteralPath (Join-Path $repo 'server/sources/codex/contract.ts') -Raw
foreach ($name in @('TurnStatus', 'ThreadActiveFlag')) {
  $generated = Get-Content -LiteralPath (Join-Path $schema "v2/$name.ts") -Raw
  $pattern = "export type $name\s*=\s*([^;]+);"
  # Compare string union members, allowing line breaks and a leading pipe.
  $actual = ([regex]::Match($generated, $pattern).Groups[1].Value -split '\|').Trim() |
    Where-Object { $_ } | Sort-Object
  $expected = ([regex]::Match($contract, $pattern).Groups[1].Value -split '\|').Trim() |
    Where-Object { $_ } | Sort-Object
  if (-not $actual -or -not $expected -or ($actual -join '|') -ne ($expected -join '|')) {
    throw "Codex contract changed: $name. Review mapping and fixtures before upgrading."
  }
}
Write-Output 'Codex contract matches installed app-server schema.'
