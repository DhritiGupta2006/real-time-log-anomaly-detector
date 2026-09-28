# LogPulse — Real-Time Log Anomaly Detector & Alert Feed (v2)

LogPulse continuously monitors application log streams, computes rolling error and volume metrics, learns statistical baseline behavior using **EWMA** and **MAD**, scrubs sensitive healthcare **PHI/PII** before aggregation, detects statistically significant anomalies, flags silent log sources (`VOLUME_DROP`), and pushes alerts with evidence to a real-time WebSocket dashboard, **AWS SNS**, and **AWS CloudWatch Logs**.

> **Architecture Positioning:** Built as a **modular monolith with a strict event-bus seam** (`EventBus` protocol in `shared/bus.py`). The stateful detector is decoupled from alert management and delivery, enabling single-process execution or distributed deployment over Redis Streams by swapping one configuration adapter.

---

## Architecture

```text
                      React Dashboard (WebSocket /ws + polling /api/state)
                                       │
                                API Gateway (FastAPI)
                                       │
               ┌───────────────────────┴───────────────────────┐
               │                                               │
    ┌──────────▼──────────┐                         ┌──────────▼──────────┐
    │  Monitoring Service │                         │    Alert Service    │
    │  - LogTailer        │                         │  - Incident FSM     │
    │  - phi_redactor     │                         │  - JSONL Journal    │
    │    (SSN, Email, ID) │                         │  - AwsNotifier      │
    └──────────┬──────────┘                         │    (boto3 to_thread,│
               │ LogEvents                          │     backoff, DLQ)   │
    ┌──────────▼──────────┐                         └──────────▲──────────┘
    │  Detection Service  │                                    │
    │  - SlidingWindow    │                                    │
    │  - EWMA / MAD       │                                    │
    │  - Baseline Freeze  ├──── EventBus (ticks, detections) ──┘
    │  - VOLUME_DROP      │
    └─────────────────────┘
```

### Traceability to Hackathon Requirements

| Requirement | Implementation | Proof in Demo / Tests |
|---|---|---|
| **Growing Log File** | `services/monitoring/tailer.py` | Rotation, truncation, partial-line buffering |
| **Domain Privacy (PHI)** | `services/monitoring/parser.py` (`phi_redactor`) | Scrubs SSNs, emails, phones, MRNs, DOBs before ingestion |
| **Sliding Window** | `services/detection/window.py` | 1s bucket ring buffer, rolling error & volume stats |
| **Mathematical Brain** | `services/detection/baseline.py` | EWMA error rate ($p_0$), MAD spread ($\sigma$), volume tracking |
| **Detector-Local Freeze** | `services/detection/engine.py` | Baseline freezes on suspicion ($z \ge Z_{\text{open}}$) without waiting for alerts |
| **Silent-Source Detection** | `services/detection/detector.py` (`VOLUME_DROP`) | Fires HIGH when volume drops $<20\%$ of expected for consecutive evaluations |
| **Incident FSM & Hysteresis** | `services/alerts/manager.py` | Dual-threshold clear ($z < Z_{\text{clear}}$), escalation-only, cooldown reopening |
| **Durability & Replay** | `services/alerts/manager.py` (`Journal`) | Append-only JSONL journal replayed at startup for crash recovery |
| **Real-Time Dashboard** | `frontend/` + `api/main.py` | Live error rate, baseline band, evidence panel, scenario controls |
| **Resilient AWS Delivery** | `services/alerts/notifiers.py` | `asyncio.to_thread`, 6-attempt exponential backoff, circuit breaker, DLQ file |

---

## Local to AWS Production Mapping

| Local Component | Local Implementation | AWS Production Equivalent |
|---|---|---|
| **Event Bus** | `shared/bus.py` (`InMemoryBus`) | **Amazon SQS / EventBridge / Kinesis** |
| **Inter-service Stream** | Redis Streams adapter | **Amazon Managed Streaming for Kafka (MSK)** |
| **Incident Journal** | Append-only JSONL (`logs/journal.jsonl`) | **Amazon DynamoDB** (single-table design) |
| **Notifications** | LocalStack / Console fallback | **Amazon SNS** (SMS, PagerDuty, Email) |
| **Audit Logs** | LocalStack / Console | **Amazon CloudWatch Logs** |
| **Dead Letter Queue** | File-based JSONL (`logs/dlq.jsonl`) | **Amazon SQS Dead Letter Queue (DLQ)** |
| **Container Runtime** | Docker Compose / Monolith | **AWS ECS Fargate / EKS** |

---

## Quickstart

```bash
# 1. Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# 2. Run the full test suite (48 unit, boundary, replay, and config tests)
pytest -v

# 3. Generate deterministic test fixtures
python tools/make_fixtures.py

# 4. Run the application
python -m simulator.log_simulator          # Terminal 1: Generates traffic & logs
uvicorn api.main:app --port 8000           # Terminal 2: Modular monolith & UI
```
Open **http://localhost:8000** to view the live dashboard.

### Docker Deployments
```bash
# Shape A: Modular monolith (FastAPI + React frontend)
docker compose --profile monolith up --build

# Shape B: Microservices (Monitoring, Detection, Alerts, Gateway)
docker compose --profile microservices up --build
```

---

## Key Differentiators

### 1. Healthcare Domain Privacy (PHI Redactor)
Before any log line enters memory buffers, queues, or AWS payloads, `phi_redactor` executes regex filters scrubbing:
- Social Security Numbers (`\b\d{3}-\d{2}-\d{4}\b`) $\to$ `[REDACTED_SSN]`
- Email addresses $\to$ `[REDACTED_EMAIL]`
- US phone numbers $\to$ `[REDACTED_PHONE]`
- Medical Record Numbers (MRN) and Patient IDs $\to$ `[REDACTED_ID]`
- Date of Birth $\to$ `[REDACTED_DOB]`

### 2. Detector-Local Baseline Freeze & MAD Spread
Standard moving averages absorb anomalies, deflating z-scores during extended outages.
- **MAD Spread:** Spread is calculated using Median Absolute Deviation ($1.4826 \times \text{MAD}$), resilient to outlier distortion.
- **Local Freeze:** As soon as an evaluation breaches the raw suspicion gate ($z \ge Z_{\text{open}}$ or volume drop ratio), `baseline.freeze()` is triggered immediately inside the detector.
- **No Feedback Loop:** The detector does not query or await Alert FSM state, maintaining a clean one-way seam.

### 3. Silent-Source Detection (`VOLUME_DROP`)
Traditional error-rate monitors fail when an upstream service crashes completely and emits zero logs ($0/0 = 0\%$).
- Tracks an EWMA expected lines/second volume baseline.
- If current volume falls below $20\%$ (`VOLUME_DROP_RATIO`) of expected volume for 5 consecutive evaluations, a `HIGH` severity alert is emitted.

### 4. Resilient AWS Delivery
All AWS SDK (`boto3`) operations are dispatched asynchronously via `asyncio.to_thread`:
- **6-Attempt Exponential Backoff:** Retries transient AWS failures up to a 60s cap.
- **Circuit Breaker:** Opens after 3 consecutive failures to avoid retry storms.
- **Dead Letter Queue (DLQ):** Exhausted notifications are recorded in `logs/dlq.jsonl`.
- **LocalStack Parity:** Set `AWS_ENDPOINT_URL=http://localhost:4566` to test with LocalStack without modifying application code.

---

## Observability & Endpoints

- `GET /health` or `GET /healthz`: Process health and uptime.
- `GET /readyz`: Readiness probe reporting AWS connection status and degradation state.
- `GET /metrics`: Prometheus-compatible metrics (`logpulse_uptime_seconds`, `logpulse_ws_clients`, `logpulse_alerts_active`, `logpulse_aws_retries_total`, `logpulse_aws_dlq_total`, `logpulse_notifier_degraded`).
- `GET /api/state`: Snapshot mirror for REST polling fallback.
- `GET /api/alerts`: List of all active and historical alerts.
- `WS /ws`: Real-time WebSocket event stream for metric ticks and alert transitions.

---

## Known Limitations & Honest Trade-offs

1. **Regex-Based Redaction:** Regex PHI redaction represents defense-in-depth, not a compliance guarantee. The primary control is preventing PHI from being logged at the source.
2. **Quiet Periods vs. Volume Drop:** Natural overnight quiet periods in real traffic can trigger volume drop alarms if traffic falls below 20%. A seasonal time-of-day baseline is the documented next step.
3. **Single Active Alert Focus:** The default demo alert manager focuses on one active incident per service. Distributed multi-incident correlation across microservices is handled in Stage 2.
# real-time-log-anomaly-detector
