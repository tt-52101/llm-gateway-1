from unittest.mock import AsyncMock

import pytest

from app.common.time import utc_now
from app.domain.log import RequestLogCreate
from app.services.proxy_service import (
    _DETAIL_PAYLOAD_FIELDS,
    ProxyService,
    _strip_detail_payload,
)


def _make_log_data() -> RequestLogCreate:
    return RequestLogCreate(
        request_time=utc_now(),
        api_key_id=1,
        api_key_name="k",
        requested_model="m",
        request_headers={"authorization": "***"},
        response_headers={"content-type": "application/json"},
        request_body={"model": "m", "messages": []},
        response_body="hello",
        response_status=200,
        usage_details={"input_tokens": 10, "output_tokens": 5},
        error_info="boom",
        converted_request_body={"converted": True},
        upstream_response_body="raw-upstream",
    )


@pytest.mark.asyncio
async def test_write_log_keeps_details_when_enabled():
    log_repo = AsyncMock()
    service = ProxyService(
        model_repo=AsyncMock(), provider_repo=AsyncMock(), log_repo=log_repo
    )
    log_data = _make_log_data()

    await service._write_log(log_data, record_details=True)

    log_repo.create.assert_awaited_once()
    written = log_repo.create.call_args.args[0]
    assert written.request_body == {"model": "m", "messages": []}
    assert written.response_body == "hello"
    assert written.request_headers == {"authorization": "***"}
    assert written.response_headers == {"content-type": "application/json"}
    assert written.converted_request_body == {"converted": True}
    assert written.upstream_response_body == "raw-upstream"


@pytest.mark.asyncio
async def test_write_log_strips_payload_when_disabled():
    log_repo = AsyncMock()
    service = ProxyService(
        model_repo=AsyncMock(), provider_repo=AsyncMock(), log_repo=log_repo
    )
    log_data = _make_log_data()

    await service._write_log(log_data, record_details=False)

    log_repo.create.assert_awaited_once()
    written = log_repo.create.call_args.args[0]

    # Heavy payload (bodies & headers) is dropped.
    assert written.request_body is None
    assert written.response_body is None
    assert written.request_headers is None
    assert written.response_headers is None
    assert written.converted_request_body is None
    assert written.upstream_response_body is None

    # Metadata, usage details and error info are retained.
    assert written.api_key_id == 1
    assert written.response_status == 200
    assert written.usage_details == {"input_tokens": 10, "output_tokens": 5}
    assert written.error_info == "boom"


def test_strip_detail_payload_nulls_only_payload_fields():
    log_data = _make_log_data()

    _strip_detail_payload(log_data)

    # Exactly the documented payload fields are dropped.
    for field in _DETAIL_PAYLOAD_FIELDS:
        assert getattr(log_data, field) is None, field

    # usage_details and error_info are never part of the stripped set, so the
    # debug-log and DB paths keep them even when detail logging is disabled.
    assert "usage_details" not in _DETAIL_PAYLOAD_FIELDS
    assert "error_info" not in _DETAIL_PAYLOAD_FIELDS
    assert log_data.usage_details == {"input_tokens": 10, "output_tokens": 5}
    assert log_data.error_info == "boom"

