import asyncio

import pytest

from shared.bus import InMemoryBus


@pytest.mark.asyncio
async def test_in_memory_bus_publish_and_subscribe():
    bus = InMemoryBus(queue_size=10)
    received = []

    async def reader():
        async for item in bus.subscribe("alerts"):
            received.append(item)
            if len(received) == 2:
                break

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.01)  # allow subscription to register

    await bus.publish("alerts", {"id": "1", "sev": 3})
    await bus.publish("alerts", {"id": "2", "sev": 4})

    await asyncio.wait_for(task, timeout=1.0)
    assert len(received) == 2
    assert received[0]["id"] == "1"
    assert received[1]["id"] == "2"


@pytest.mark.asyncio
async def test_ticks_drop_oldest_policy():
    # queue_size = 2; publish 4 items on 'ticks' topic
    bus = InMemoryBus(queue_size=2)

    gen = bus.subscribe("ticks")
    await asyncio.sleep(0.01)

    # Publish 4 items without reading
    for i in range(4):
        await bus.publish("ticks", {"tick": i})

    # The oldest (0 and 1) were dropped; queue contains 2 and 3
    first = await gen.__anext__()
    second = await gen.__anext__()

    assert first["tick"] == 2
    assert second["tick"] == 3
    assert bus.drops >= 2
