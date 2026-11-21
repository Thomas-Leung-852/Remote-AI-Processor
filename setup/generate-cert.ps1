# ─── Generate Self-Signed Certificate for AI Processor HTTPS ─────────────────
# Run from the setup/ folder:
#   cd setup
#   .\generate-cert.ps1
#
# Optional — override the detected IP:
#   .\generate-cert.ps1 -IP 192.168.1.50
#
# Output: ..\certs\server.key  and  ..\certs\server.crt
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$IP = ""
)

$CertsDir = "..\processor\certs"
$KeyFile  = "$CertsDir\server.key"
$CertFile = "$CertsDir\server.crt"
$Days     = 3650

# ── Auto-detect LAN IP if not supplied ───────────────────────────────────────
if (-not $IP) {
    $IP = (
        Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -in @("Dhcp", "Manual")
        } |
        Sort-Object InterfaceMetric |
        Select-Object -First 1
    ).IPAddress

    if (-not $IP) {
        Write-Host ""
        Write-Host "❌  Could not detect a LAN IP address." -ForegroundColor Red
        Write-Host "    Run with an explicit IP:"
        Write-Host "      .\generate-cert.ps1 -IP 192.168.1.x"
        Write-Host ""
        exit 1
    }
}

# Check openssl is available
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "❌  openssl not found." -ForegroundColor Red
    Write-Host "    Install one of:"
    Write-Host "      • Git for Windows  → https://git-scm.com  (includes openssl)"
    Write-Host "      • OpenSSL for Windows → https://slproweb.com/products/Win32OpenSSL.html"
    Write-Host ""
    exit 1
}

# Create certs/ folder if it doesn't exist
if (-not (Test-Path $CertsDir)) {
    New-Item -ItemType Directory -Path $CertsDir | Out-Null
    Write-Host "📁  Created $CertsDir"
}

Write-Host ""
Write-Host "🔐  Generating self-signed certificate (RSA 4096, $Days days)..."
Write-Host "    Detected IP: $IP"
Write-Host ""

openssl req -x509 -newkey rsa:4096 `
    -keyout $KeyFile `
    -out    $CertFile `
    -days   $Days `
    -nodes `
    -subj   "/CN=ai-processor" `
    -addext "subjectAltName=IP:${IP},IP:127.0.0.1"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅  Certificate generated successfully:" -ForegroundColor Green
    Write-Host "    Key : $((Resolve-Path $KeyFile).Path)"
    Write-Host "    Cert: $((Resolve-Path $CertFile).Path)"
    Write-Host ""
    Write-Host "──────────────────────────────────────────────────────"
    Write-Host "Next steps:"
    Write-Host "  1. Open processor\.env"
    Write-Host "  2. Set:"
    Write-Host "       SSL_KEY_PATH=./certs/server.key"
    Write-Host "       SSL_CERT_PATH=./certs/server.crt"
    Write-Host "  3. Restart the processor: npm start"
    Write-Host "  4. Update AI_PROCESSOR_URL on clients to use https://"
    Write-Host "──────────────────────────────────────────────────────"
    Write-Host ""
    Write-Host "⚠️  Self-signed certificate note:" -ForegroundColor Yellow
    Write-Host "    Browsers will show a security warning — this is expected."
    Write-Host "    curl: add -k flag.  client.js: already configured."
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌  openssl failed. See error above." -ForegroundColor Red
    exit 1
}
