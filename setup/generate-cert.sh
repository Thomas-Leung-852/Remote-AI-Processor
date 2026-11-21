#!/usr/bin/env bash
# ─── Generate Self-Signed Certificate for AI Processor HTTPS ─────────────────
# Run from the setup/ folder:
#   cd setup
#   bash generate-cert.sh
#
# Optional — override the detected IP:
#   bash generate-cert.sh 192.168.1.50
#
# Output: ../certs/server.key  and  ../certs/server.crt
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/../processor/certs"
KEY_FILE="$CERTS_DIR/server.key"
CERT_FILE="$CERTS_DIR/server.crt"
DAYS=3650

# ── Use argument IP or auto-detect LAN IP ────────────────────────────────────
if [[ -n "${1:-}" ]]; then
    PC_IP="$1"
    echo ""
    echo "ℹ️   Using provided IP: $PC_IP"
else
    # Try ip route first (most reliable), then hostname -I as fallback
    PC_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1)

    if [[ -z "$PC_IP" ]]; then
        PC_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi

    if [[ -z "$PC_IP" ]]; then
        echo ""
        echo "❌  Could not detect a LAN IP address."
        echo "    Run with an explicit IP:"
        echo "      bash generate-cert.sh 192.168.1.x"
        echo ""
        exit 1
    fi
fi

# Check openssl is available
if ! command -v openssl &>/dev/null; then
    echo ""
    echo "❌  openssl not found."
    echo "    Install it with:"
    echo "      Ubuntu/Debian:  sudo apt install openssl"
    echo "      Fedora/RHEL:    sudo dnf install openssl"
    echo ""
    exit 1
fi

# Create certs/ folder if it doesn't exist
mkdir -p "$CERTS_DIR"

echo ""
echo "🔐  Generating self-signed certificate (RSA 4096, ${DAYS} days)..."
echo "    Detected IP: $PC_IP"
echo ""

openssl req -x509 -newkey rsa:4096 \
    -keyout "$KEY_FILE" \
    -out    "$CERT_FILE" \
    -days   "$DAYS" \
    -nodes \
    -subj   "/CN=ai-processor" \
    -addext "subjectAltName=IP:${PC_IP},IP:127.0.0.1"

# Restrict private key permissions
chmod 600 "$KEY_FILE"

echo ""
echo "✅  Certificate generated successfully:"
echo "    Key : $(realpath "$KEY_FILE")"
echo "    Cert: $(realpath "$CERT_FILE")"
echo ""
echo "──────────────────────────────────────────────────────"
echo "Next steps:"
echo "  1. Open processor/.env"
echo "  2. Set:"
echo "       SSL_KEY_PATH=./certs/server.key"
echo "       SSL_CERT_PATH=./certs/server.crt"
echo "  3. Restart the processor: npm start"
echo "  4. Update AI_PROCESSOR_URL on clients to use https://"
echo "──────────────────────────────────────────────────────"
echo ""
echo "⚠️  Self-signed certificate note:"
echo "    Browsers will show a security warning — this is expected."
echo "    curl: add -k flag.  client.js: already configured."
echo ""
