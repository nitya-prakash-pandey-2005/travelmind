"""google-genai imports and builds a client under the websockets this environment resolves (its
non-Live code imports websockets too). No network: constructing a client sends nothing."""

import websockets
from google import genai
from google.genai import types


def test_google_genai_imports_and_builds_a_client():
    client = genai.Client(
        api_key="dummy-key-not-real",
        vertexai=False,
        http_options=types.HttpOptions(base_url="https://generativelanguage.googleapis.com/"),
    )
    try:
        assert client.aio.models is not None
    finally:
        client.close()
    assert websockets.__version__
