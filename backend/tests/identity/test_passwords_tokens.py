import asyncio
import threading
import time
from uuid import uuid4

from travelmind.identity import passwords
from travelmind.identity.passwords import hash_password, verify_password
from travelmind.identity.tokens import hash_token, make_scoped_token, new_token, split_scoped_token


def test_password_hash_roundtrip():
    hashed = hash_password("correct-horse-battery")
    assert hashed != "correct-horse-battery"
    assert verify_password(hashed, "correct-horse-battery")
    assert not verify_password(hashed, "wrong-password-123")


def test_verify_password_with_garbage_hash_is_false():
    assert not verify_password("not-an-argon2-hash", "anything")


def test_tokens_are_random_and_hashed():
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 40
    assert hash_token(a) == hash_token(a)
    assert hash_token(a) != a and len(hash_token(a)) == 64


def test_scoped_token_roundtrip():
    agency_id = uuid4()
    token, secret = make_scoped_token(agency_id)
    assert split_scoped_token(token) == (agency_id, secret)


def test_split_scoped_token_rejects_garbage():
    assert split_scoped_token("no-dot-here") is None
    assert split_scoped_token("not-a-uuid.secret") is None
    assert split_scoped_token(f"{uuid4()}.") is None


class _ConcurrencyProbe:
    """Stands in for the argon2 hasher and records how many hashes run at once."""

    def __init__(self):
        self._lock = threading.Lock()
        self.active = 0
        self.peak = 0

    def hash(self, password):
        with self._lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        time.sleep(0.05)
        with self._lock:
            self.active -= 1
        return f"hashed:{password}"


async def test_password_hashing_concurrency_is_capped(monkeypatch):
    probe = _ConcurrencyProbe()
    monkeypatch.setattr(passwords, "_hasher", probe)
    results = await asyncio.gather(*(passwords.hash_password_async(f"pw-{i}") for i in range(12)))
    assert results == [f"hashed:pw-{i}" for i in range(12)]
    assert 2 <= probe.peak <= passwords.ARGON2_MAX_CONCURRENCY == 4
