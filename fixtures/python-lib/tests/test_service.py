from pkg.service import run_service


def test_run_service():
    assert run_service("1")["id"] == "1"
