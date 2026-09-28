"""Event bus abstraction (IMPLEMENTATION_PLAN-2-2.md §5.2).

Delivers the modular monolith with a strict event-bus seam:
  - EventBus protocol: publish() and subscribe()
  - InMemoryBus: bounded asyncio.Queue per subscriber
    * 'ticks' topic uses drop-oldest policy (slow clients never block detection)
    * 'detections' and 'alerts' topics never drop (publisher awaits on backpressure)
  - RedisStreamsBus: Stage 2 distributed adapter over Redis Streams
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any, Protocol

log = logging.getLogger("logpulse.bus")


class EventBus(Protocol):
    """Event bus interface for the detector-alert service seam."""

    async def publish(self, topic: str, event: Any) -> None:
        """Publish an event to a topic."""
        ...

    def subscribe(self, topic: str, group: str = "default") -> AsyncIterator[Any]:
        """Subscribe to a topic with a consumer group name."""
        ...


class Subscription:
    """Active subscription to a topic in InMemoryBus."""

    def __init__(self, bus: InMemoryBus, topic: str, queue_size: int) -> None:
        self.bus = bus
        self.topic = topic
        self.q: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
        self.bus._subscribers[topic].append(self.q)
        self._closed = False

    def __aiter__(self) -> Subscription:
        return self

    async def __anext__(self) -> Any:
        if self._closed:
            raise StopAsyncIteration
        try:
            item = await self.q.get()
            self.q.task_done()
            return item
        except asyncio.CancelledError:
            self.close()
            raise

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            if self.q in self.bus._subscribers[self.topic]:
                self.bus._subscribers[self.topic].remove(self.q)

    async def __aenter__(self) -> Subscription:
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


class InMemoryBus:
    """In-memory event bus with topic-specific drop policies.

    Drop policy (spec §5.2):
      - 'ticks': drop-oldest when full (a slow chart client must never stall detection).
      - 'detections' and 'alerts': never dropped; the publisher awaits on a full queue.
    """

    def __init__(self, queue_size: int = 100) -> None:
        self.queue_size = queue_size
        self._subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self.stalls: int = 0
        self.drops: int = 0

    async def publish(self, topic: str, event: Any) -> None:
        """Publish an event to all subscriber queues for the given topic."""
        queues = list(self._subscribers.get(topic, []))
        if not queues:
            return

        for q in queues:
            if topic == "ticks":
                # Drop-oldest policy for ticks
                if q.full():
                    try:
                        q.get_nowait()
                        self.drops += 1
                    except asyncio.QueueEmpty:
                        pass
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    self.drops += 1
            else:
                # Never-drop policy for detections and alerts (await with stall tracking)
                if q.full():
                    self.stalls += 1
                await q.put(event)

    def subscribe(self, topic: str, group: str = "default") -> Subscription:
        """Subscribe to a topic. Returns a Subscription immediately registered."""
        return Subscription(self, topic, self.queue_size)

    def subscriber_count(self, topic: str) -> int:
        return len(self._subscribers.get(topic, []))


class RedisStreamsBus:
    """Stage 2 adapter: EventBus over Redis Streams.

    Used when BUS_BACKEND=redis.
    """

    def __init__(self, redis_url: str) -> None:
        self.redis_url = redis_url
        self._redis = None

    async def _client(self):
        if self._redis is None:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(self.redis_url, decode_responses=True)
        return self._redis

    async def publish(self, topic: str, event: Any) -> None:
        r = await self._client()
        payload = event.model_dump_json() if hasattr(event, "model_dump_json") else json.dumps(event)
        await r.xadd(f"logpulse:{topic}", {"data": payload})

    async def subscribe(self, topic: str, group: str = "default") -> AsyncIterator[Any]:
        r = await self._client()
        stream_name = f"logpulse:{topic}"
        try:
            await r.xgroup_create(stream_name, group, id="0", mkstream=True)
        except Exception:
            pass

        consumer_id = f"worker-{id(asyncio.current_task())}"
        while True:
            entries = await r.xreadgroup(group, consumer_id, {stream_name: ">"}, count=10, block=2000)
            if entries:
                for _, messages in entries:
                    for msg_id, fields in messages:
                        data = json.loads(fields.get("data", "{}"))
                        yield data
                        await r.xack(stream_name, group, msg_id)
            else:
                await asyncio.sleep(0.1)
