import pytest


@pytest.fixture(autouse=True)
def isolate_astra_usage(monkeypatch):
    # Simulated responses must never pollute the user's real usage ledger.
    monkeypatch.setattr('backend.astra.record_usage', lambda record: None)
