import asyncio
from concurrent.futures import ThreadPoolExecutor

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

# Each argon2 call uses ~64 MiB and 4 lanes. A small dedicated pool caps memory (~256 MiB)
# under a login burst and keeps password work out of the shared threadpool other routes use.
ARGON2_MAX_CONCURRENCY = 4
_argon2_pool = ThreadPoolExecutor(max_workers=ARGON2_MAX_CONCURRENCY, thread_name_prefix="argon2")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


async def hash_password_async(password: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_argon2_pool, hash_password, password)


async def verify_password_async(password_hash: str, password: str) -> bool:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_argon2_pool, verify_password, password_hash, password)
