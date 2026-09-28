import os

from services.monitoring.parser import parse_line, phi_redactor
from services.monitoring.tailer import LogTailer


def test_phi_redactor_scrubs_sensitive_data():
    raw = (
        "Patient John Doe ssn: 123-45-6789, email: john.doe@hospital.org, "
        "patient_id: PT-98765, phone: (555) 123-4567, dob: 1980-01-01"
    )
    scrubbed, count = phi_redactor(raw)
    assert "[REDACTED_SSN]" in scrubbed
    assert "[REDACTED_EMAIL]" in scrubbed
    assert "[REDACTED_ID]" in scrubbed
    assert "[REDACTED_PHONE]" in scrubbed
    assert "[REDACTED_DOB]" in scrubbed
    assert "123-45-6789" not in scrubbed
    assert "john.doe@hospital.org" not in scrubbed
    assert "PT-98765" not in scrubbed
    assert count >= 5


def test_parse_valid_and_levels():
    e = parse_line("2026-09-28T10:00:00.123+00:00 ERROR checkout upstream timeout")
    assert e and e.level == "ERROR" and e.service == "checkout" and e.is_error
    assert parse_line("2026-09-28T10:00:00Z INFO auth ok").is_error is False
    assert parse_line("2026-09-28 10:00:00 FATAL db down").level == "CRITICAL"
    assert parse_line("2026-09-28T10:00:00Z WARN x y").level == "WARNING"


def test_parse_malformed_returns_none():
    for bad in [
        "",
        "garbage",
        "2026-09-28T10:00:00Z",
        "2026-09-28T10:00:00Z BOGUS svc msg",
        "2026-13-45T99:00:00Z INFO a b",
    ]:
        assert parse_line(bad) is None


def test_tailer_starts_at_end_then_reads_growth(tmp_path):
    p = tmp_path / "a.log"
    p.write_text("old1\nold2\n")
    t = LogTailer(str(p))
    assert t.read_new() == []
    with open(p, "a") as f:
        f.write("new1\nnew2\n")
    assert t.read_new() == ["new1", "new2"]


def test_tailer_holds_partial_line(tmp_path):
    p = tmp_path / "a.log"
    p.write_text("")
    t = LogTailer(str(p), from_start=True)
    with open(p, "a") as f:
        f.write("half")
    assert t.read_new() == []
    with open(p, "a") as f:
        f.write("-done\nnext\n")
    assert t.read_new() == ["half-done", "next"]


def test_tailer_handles_rotation_and_truncation_and_missing(tmp_path):
    p = tmp_path / "a.log"
    p.write_text("")
    t = LogTailer(str(p), from_start=True)
    with open(p, "a") as f:
        f.write("a1\n")
    assert t.read_new() == ["a1"]
    # rotation: old file moved, new one created; unread tail of old file is not lost
    with open(p, "a") as f:
        f.write("a2\n")
    os.rename(p, tmp_path / "a.log.1")
    p.write_text("b1\n")
    assert t.read_new() == ["a2", "b1"]
    assert t.rotations == 1
    # truncation in place
    p.write_text("c\n")  # shorter than what was already read -> detected as truncation
    assert t.read_new() == ["c"]
    # disappearance, then reappearance
    os.remove(p)
    assert t.read_new() == []
    p.write_text("d1\n")
    assert t.read_new() == ["d1"]


def test_tailer_survives_invalid_utf8(tmp_path):
    p = tmp_path / "a.log"
    p.write_bytes(b"")
    t = LogTailer(str(p), from_start=True)
    with open(p, "ab") as f:
        f.write(b"bad \xff\xfe bytes\n")
    assert len(t.read_new()) == 1
