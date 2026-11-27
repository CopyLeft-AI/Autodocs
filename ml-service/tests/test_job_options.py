"""Per-job model choices and the record of which models produced a result."""

import pytest
from pydantic import ValidationError

import config
from job_options import JobOptions, apply_options, models_used


def test_no_options_keeps_the_configuration():
    loaded = config.load_config()
    boundaries, annotate = apply_options(loaded, None)
    assert (boundaries, annotate) == (loaded.steps["boundaries"], loaded.steps["annotate"])


def test_options_change_models_but_never_where_requests_go():
    loaded = config.load_config()
    boundaries, annotate = apply_options(loaded, {"boundaryModel": "small", "annotateModel": "big", "summaryWordLimit": 12})
    assert (boundaries.model, annotate.model, annotate.summary_word_limit) == ("small", "big", 12)
    assert annotate.base_url == loaded.steps["annotate"].base_url
    assert models_used(boundaries, annotate)["annotate"] == {"backend": annotate.backend, "model": "big"}
    # Unknown keys such as a server address are ignored by validation.
    assert not hasattr(JobOptions.model_validate({"baseUrl": "http://elsewhere"}), "baseUrl")


def test_invalid_options_are_rejected():
    with pytest.raises(ValidationError):
        JobOptions(summaryWordLimit=0)


def test_alternative_models_can_be_stored():
    config.update_file_config({"steps": {"annotate": {"alternativeModels": "a, b"}}})
    assert config.public_view(config.read_file_config())["steps"]["annotate"]["stored"]["alternativeModels"] == "a, b"
