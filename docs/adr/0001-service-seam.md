# ADR 0001: Detection vs. Alerts Service Seam

## Status
Accepted

## Context
LogPulse monitors real-time streaming application logs to detect error-rate anomalies and silent sources (`VOLUME_DROP`), while delivering notifications and driving real-time WebSocket dashboards.

We evaluated two architectural extremes:
1. **Unstructured Monolith:** Everything running in one process without internal boundaries or explicit contracts.
2. **Premature Distributed Microservices:** Splitting tailing, parsing, sliding windows, baselines, detectors, incident management, WebSocket hubs, and AWS notifiers across 5+ independent network services.

Each extreme has major drawbacks. An unstructured monolith couples disparate failure domains (e.g., slow AWS SDK retries or client WebSocket stalls could block fast-path log tailing). A sprawling microservices architecture introduces distributed transaction overhead, serialization latency, deployment fragility, and network failure modes across boundaries that should be in-memory.

## Decision
We establish **exactly one architectural seam**: dividing the system into the **Detector Service** and the **Alert Service**, connected by an **EventBus** interface.

```
+-------------------------------------------------------------+
|                     DETECTOR SERVICE                        |
|  [Log Tailer] -> [Parser + PHI Redactor] -> [SlidingWindow] |
|                             |                               |
|               [EWMA/MAD Baseline & Freeze]                  |
|                             |                               |
|                [Detector (Rate & Volume)]                   |
+-------------------------------------------------------------+
                               |
                   EventBus (ticks & detections)
                               |
+-------------------------------------------------------------+
|                      ALERT SERVICE                          |
|    [Incident FSM (Hysteresis & Cooldown)] -> [JSONL Journal]|
|                             |                               |
|        [WebSocket Gateway]  |   [Async AWS Notifier]        |
|        (/ws, /metrics)      |   (boto3, Retry, DLQ)         |
+-------------------------------------------------------------+
```

### Key Principles of the Boundary:
1. **State & Scaling Symmetry:**
   - **Detector Service:** Stateful (ring buffers, sliding window samples, EWMA rate and MAD spread), driven by incoming log line volume (10k+ lines/sec), single-writer per log stream.
   - **Alert Service:** Stateful along incident lifecycles (Incident FSM, JSONL journal, notification circuit breakers), driven by evaluations, connected clients, and downstream notification APIs (SNS, CloudWatch).
2. **Detector-Local Baseline Freeze:**
   - The baseline freeze operates strictly within the detector service based on raw metric breaches (`z >= Z_OPEN` or `volume_rate < VOLUME_DROP_RATIO * expected_volume`).
   - The baseline does **not** query or depend on the Alert Service's incident state machine. This eliminates cyclic dependencies and ensures the detector remains fully functional even if the Alert Service restarts.
3. **Drop Policy Along the Seam:**
   - Topic `ticks`: Drop-oldest policy. A slow dashboard subscriber must never stall detection.
   - Topics `detections` and `alerts`: Zero drop policy with backpressure. Critical state changes are guaranteed to reach the Alert Service and the durable journal.
4. **Two-Stage Deployment:**
   - **Stage 1 (Default):** Both services execute within a single modular process connected by `InMemoryBus` using bounded `asyncio.Queue` instances.
   - **Stage 2:** The exact same codebase runs as decoupled containers communicating asynchronously over `RedisStreamsBus`.

## Consequences
- **Positive:**
  - Clear domain separation and zero circular dependencies.
  - Core math and detection algorithms remain pure, testable, and replayable in milliseconds without network mocks.
  - AWS delivery failures or slow network calls cannot starve the log tailer or WebSocket event loop.
  - Graceful degradation: The system can run single-process or distributed by swapping a single configuration flag (`BUS_BACKEND=memory` vs `BUS_BACKEND=redis`).
- **Trade-offs:**
  - `MetricTick` and `Detection` events must be serializable across the seam.
  - Alert manager cannot back-propagate custom manual overrides directly into detection windows without an explicit control message.
