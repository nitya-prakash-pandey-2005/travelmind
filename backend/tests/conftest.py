import os

os.environ["TM_ENVIRONMENT"] = "test"

import pytest  # noqa: E402

from tests.helpers import make_client  # noqa: E402


@pytest.fixture
def app():
    from travelmind.main import create_app

    return create_app()


@pytest.fixture
async def client(app):
    async with make_client(app) as c:
        yield c
