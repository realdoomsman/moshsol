$ErrorActionPreference = "Continue"
Set-Location "C:\tech\moshsol\scripts"
$env:DEV_FLOAT_SOL = "0.005"
& "C:\Users\Dooms\AppData\Roaming\npm\pnpm.cmd" rescue GizsCuKU7j5rqncwiPp5xcWwArwuC8gATs3ufmhrcQbW --go 2>&1 |
  Out-File "C:\tech\moshsol\.mainnet\auto-rescue.log" -Append -Encoding utf8
exit $LASTEXITCODE
