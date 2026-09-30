from travelmind.reference.geo import great_circle_km


def test_delhi_to_mumbai():
    assert round(great_circle_km(28.5665, 77.103104, 19.0887, 72.8679)) == 1138


def test_same_point_is_zero():
    assert great_circle_km(10.0, 20.0, 10.0, 20.0) == 0.0
