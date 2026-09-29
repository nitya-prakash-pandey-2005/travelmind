import hashlib
import secrets
from uuid import UUID


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def make_scoped_token(agency_id: UUID) -> tuple[str, str]:
    """Token of the form '<agency_id>.<secret>'. Only the secret's hash is stored.

    The agency id lets us set the tenant before looking the token up under RLS;
    tampering with it just makes the lookup miss.
    """
    secret = new_token()
    return f"{agency_id}.{secret}", secret


def split_scoped_token(token: str) -> tuple[UUID, str] | None:
    prefix, sep, secret = token.partition(".")
    if not sep or not secret:
        return None
    try:
        return UUID(prefix), secret
    except ValueError:
        return None
