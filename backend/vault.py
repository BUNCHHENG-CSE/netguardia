"""
Encrypted Credential Vault for Network Configuration Backup & Topology Automator.
Uses AES-128-CBC + HMAC-SHA256 (Fernet) with PBKDF2-HMAC-SHA256 key derivation
so device credentials (SSH passwords, private keys, enable secrets, SNMP communities)
are always encrypted at rest in SQLite and never exposed in API responses.
"""

import base64
import os
from pathlib import Path
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

VAULT_KEY_FILE = Path(__file__).parent / ".vault_master.key"
DEFAULT_SALT = b"netguardia-small-it-vault-salt-v1"


def _get_or_create_fernet() -> Fernet:
    """Load or generate a persistent master vault key derived or stored locally."""
    env_secret = os.environ.get("NETGUARDIA_VAULT_SECRET")
    if env_secret:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=DEFAULT_SALT,
            iterations=200_000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(env_secret.encode("utf-8")))
        return Fernet(key)

    if VAULT_KEY_FILE.exists():
        key = VAULT_KEY_FILE.read_bytes().strip()
        return Fernet(key)

    key = Fernet.generate_key()
    try:
        VAULT_KEY_FILE.write_bytes(key)
    except OSError:
        pass
    return Fernet(key)


_FERNET = _get_or_create_fernet()


def encrypt_secret(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a sensitive credential string for storage at rest."""
    if not plaintext:
        return None
    token = _FERNET.encrypt(plaintext.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(ciphertext: Optional[str]) -> Optional[str]:
    """Decrypt a stored credential string for active SSH/NETCONF/SNMP collection."""
    if not ciphertext:
        return None
    try:
        plaintext = _FERNET.decrypt(ciphertext.encode("utf-8"))
        return plaintext.decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def mask_secret(ciphertext: Optional[str]) -> str:
    """Return a masked representation indicating whether a secret is stored."""
    if not ciphertext:
        return "Not configured"
    plain = decrypt_secret(ciphertext)
    if not plain:
        return "•••••••• (encrypted)"
    if len(plain) <= 4:
        return "••••••••"
    return f"••••••••{plain[-2:]}"
