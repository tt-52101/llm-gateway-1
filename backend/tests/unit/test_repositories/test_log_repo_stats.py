
import pytest
from datetime import datetime, timezone
from app.domain.log import RequestLogCreate, LogCostStatsQuery
from app.repositories.sqlalchemy.log_repo import SQLAlchemyLogRepository

@pytest.mark.asyncio
async def test_get_cost_stats_grouping(db_session):
    repo = SQLAlchemyLogRepository(db_session)
    now = datetime.now(timezone.utc)

    # 1. Insert Log 1: requested="model-A", target="target-X", cost=1.0
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="model-A",
        target_model="target-X",
        total_cost=1.0,
        input_cost=0.5,
        output_cost=0.5,
        input_tokens=10,
        output_tokens=10,
        response_status=200,
        api_key_id=1,
        provider_id=1,
        is_stream=False
    ))

    # 2. Insert Log 2: requested="model-A", target="target-Y", cost=2.0
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="model-A",
        target_model="target-Y",
        total_cost=2.0,
        input_cost=1.0,
        output_cost=1.0,
        input_tokens=20,
        output_tokens=20,
        response_status=200,
        api_key_id=1,
        provider_id=1,
        is_stream=False
    ))

    # 3. Insert Log 3: requested="model-B", target="target-X", cost=4.0
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="model-B",
        target_model="target-X",
        total_cost=4.0,
        input_cost=2.0,
        output_cost=2.0,
        input_tokens=40,
        output_tokens=40,
        response_status=200,
        api_key_id=1,
        provider_id=1,
        is_stream=False
    ))

    # Query 1: Default (group by requested_model)
    query_req = LogCostStatsQuery(
        start_time=datetime(2000, 1, 1, tzinfo=timezone.utc),
        group_by="request_model"
    )
    stats_req = await repo.get_cost_stats(query_req)
    
    # Expected: model-A (3.0), model-B (4.0)
    # Sort order is total_cost desc, so model-B first
    assert len(stats_req.by_model) == 2
    assert stats_req.by_model[0].requested_model == "model-B"
    assert stats_req.by_model[0].total_cost == 4.0
    assert stats_req.by_model[1].requested_model == "model-A"
    assert stats_req.by_model[1].total_cost == 3.0

    # Query 2: Group by provider_model
    query_prov = LogCostStatsQuery(
        start_time=datetime(2000, 1, 1, tzinfo=timezone.utc),
        group_by="provider_model"
    )
    stats_prov = await repo.get_cost_stats(query_prov)

    # Expected: target-X (5.0), target-Y (2.0)
    # target-X (1.0 + 4.0 = 5.0)
    assert len(stats_prov.by_model) == 2
    assert stats_prov.by_model[0].requested_model == "target-X"  # The field is still named requested_model but contains target
    assert stats_prov.by_model[0].total_cost == 5.0
    assert stats_prov.by_model[1].requested_model == "target-Y"
    assert stats_prov.by_model[1].total_cost == 2.0


@pytest.mark.asyncio
async def test_get_cost_stats_call_health_and_stream_ttfb(db_session):
    repo = SQLAlchemyLogRepository(db_session)
    now = datetime.now(timezone.utc)

    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="chat",
        target_model="model-a",
        provider_name="provider-a",
        response_status=200,
        first_byte_delay_ms=100,
        is_stream=True,
        is_completed=True,
        trace_id="success-stream",
    ))
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="chat",
        target_model="model-a",
        provider_name="provider-a",
        response_status=204,
        first_byte_delay_ms=900,
        is_stream=False,
        is_completed=True,
        trace_id="success-non-stream",
    ))
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="chat",
        target_model="model-a",
        provider_name="provider-a",
        response_status=500,
        first_byte_delay_ms=300,
        is_stream=True,
        is_completed=True,
        trace_id="failed-with-retry",
    ))
    # A retry-attempt row shares the trace and must not be counted as a separate
    # client call.
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="chat",
        target_model="model-b",
        provider_name="provider-b",
        response_status=502,
        first_byte_delay_ms=800,
        is_stream=True,
        is_completed=True,
        trace_id="failed-with-retry",
        retry_count=1,
    ))
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="chat",
        target_model="model-c",
        provider_name="provider-c",
        response_status=None,
        is_stream=True,
        is_completed=True,
        trace_id="missing-status",
    ))
    # In-progress rows are excluded from all dashboard stats.
    await repo.create(RequestLogCreate(
        request_time=now,
        requested_model="chat",
        target_model="model-d",
        provider_name="provider-d",
        response_status=None,
        is_stream=True,
        is_completed=False,
        trace_id="in-progress",
    ))

    stats = await repo.get_cost_stats(LogCostStatsQuery(
        start_time=datetime(2000, 1, 1, tzinfo=timezone.utc),
    ))

    assert stats.summary.request_count == 4
    assert stats.summary.success_count == 2
    assert stats.summary.failure_count == 2
    assert stats.summary.success_rate == 0.5

    assert len(stats.model_call_stats) == 2
    provider_a = next(
        item for item in stats.model_call_stats
        if item.provider_name == "provider-a"
    )
    assert provider_a.model_name == "model-a"
    assert provider_a.request_count == 3
    assert provider_a.success_count == 2
    assert provider_a.failure_count == 1
    assert provider_a.success_rate == pytest.approx(2 / 3)
    assert provider_a.avg_first_byte_time_ms == 200
    assert provider_a.max_first_byte_time_ms == 300

    provider_c = next(
        item for item in stats.model_call_stats
        if item.provider_name == "provider-c"
    )
    assert provider_c.request_count == 1
    assert provider_c.failure_count == 1
    assert provider_c.avg_first_byte_time_ms is None
    assert provider_c.max_first_byte_time_ms is None
