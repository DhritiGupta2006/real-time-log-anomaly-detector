import pytest

from shared.config import ConfigError, Settings


def test_valid_default_settings_pass():
    s = Settings()
    s.validate()
    assert s.window_seconds == 10.0


def test_invalid_window_seconds():
    with pytest.raises(ConfigError, match="WINDOW_SECONDS"):
        Settings(window_seconds=0).validate()


def test_eval_interval_exceeds_window():
    with pytest.raises(ConfigError, match="EVAL_INTERVAL_SECONDS"):
        Settings(window_seconds=5.0, eval_interval_seconds=10.0).validate()


def test_invalid_ewma_alpha():
    with pytest.raises(ConfigError, match="EWMA_ALPHA"):
        Settings(ewma_alpha=1.5).validate()
    with pytest.raises(ConfigError, match="EWMA_ALPHA"):
        Settings(ewma_alpha=0.0).validate()


def test_invalid_hysteresis_thresholds():
    with pytest.raises(ConfigError, match="Z_OPEN > Z_CLEAR"):
        Settings(z_open=1.5, z_clear=2.0).validate()


def test_invalid_volume_drop_ratios():
    with pytest.raises(ConfigError, match="VOLUME_DROP_RATIO"):
        Settings(volume_drop_ratio=0.8, volume_drop_clear_ratio=0.4).validate()


def test_invalid_bus_backend():
    with pytest.raises(ConfigError, match="BUS_BACKEND"):
        Settings(bus_backend="kafka").validate()


def test_redis_requires_url():
    with pytest.raises(ConfigError, match="REDIS_URL"):
        Settings(bus_backend="redis", redis_url="").validate()


def test_unknown_notifier():
    with pytest.raises(ConfigError, match="NOTIFIERS"):
        Settings(notifiers="console,pagerduty").validate()


def test_sns_requires_topic_arn_when_aws_enabled():
    with pytest.raises(ConfigError, match="SNS_TOPIC_ARN"):
        Settings(aws_enabled=True, notifiers="console,sns", sns_topic_arn="").validate()
