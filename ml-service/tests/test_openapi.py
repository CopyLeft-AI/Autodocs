"""The generated API description must stay complete and readable."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def spec(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTODOCS_JOB_DIRECTORY", str(tmp_path / "jobs"))
    import app as service

    with TestClient(service.app) as client:
        response = client.get("/openapi.json")
        assert response.status_code == 200
        return response.json()


def test_every_operation_has_a_tag_and_a_summary(spec):
    for path, item in spec["paths"].items():
        for method, operation in item.items():
            assert operation.get("tags"), f"{method.upper()} {path} has no tag"
            assert operation.get("summary"), f"{method.upper()} {path} has no summary"


def test_every_tag_is_declared_with_a_description(spec):
    declared = {tag["name"] for tag in spec["tags"] if tag.get("description")}
    used = {tag for item in spec["paths"].values() for operation in item.values() for tag in operation["tags"]}
    assert used <= declared


def test_the_service_is_described(spec):
    assert spec["info"]["description"].strip()
    assert "/jobs/{job_id}" in spec["paths"]
    assert "/config" in spec["paths"]
