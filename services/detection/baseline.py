"""Baseline: EWMA mean (p0), MAD-based spread (sigma), expected volume tracking, warm-up gate,
and detector-local freeze (IMPLEMENTATION_PLAN-2-2.md §6.2).

Key design rule from the spec:
    "The baseline freeze must not depend on incident state."
    The detector calls freeze() as soon as a raw gate is breached, before any FSM confirmation.
    unfreeze() is called after CLEAR_EVALS consecutive clean readings + BASELINE_COOLDOWN_SECONDS.
"""

from __future__ import annotations

import statistics
import time
from collections import deque


class Baseline:
    """EWMA rate (p0) + MAD sigma + EWMA expected_volume, with warm-up and freeze.

    Parameters
    ----------
    max_samples:
        Length of the MAD observation window (default 120 from spec).
    min_samples:
        Legacy warm-up guard (samples must reach this before is_ready; prefer warmup_evals
        on the engine so the Baseline stays pure and clock-free).
    ewma_alpha:
        Smoothing factor in (0, 1). Smaller = slower-moving baseline. Spec default 0.05.
    sigma_floor:
        Minimum spread; prevents ÷0 on a perfectly flat baseline. Spec default 0.01.
    cooldown_seconds:
        After unfreeze(), the baseline stays frozen for this extra duration to absorb
        post-incident data only once the signal is genuinely clean.
        This clock check happens in is_frozen(now), keeping freeze/unfreeze themselves
        pure (they accept no clock argument).
    """

    def __init__(
        self,
        max_samples: int = 120,
        min_samples: int = 20,
        ewma_alpha: float = 0.05,
        sigma_floor: float = 0.01,
        cooldown_seconds: float = 30.0,
        min_std: float | None = None,
    ) -> None:
        if min_std is not None:
            sigma_floor = min_std
        self.min_samples = min_samples
        self.alpha = ewma_alpha
        self.sigma_floor = sigma_floor
        self.min_std = sigma_floor
        self.cooldown_seconds = cooldown_seconds

        self._obs: deque[float] = deque(maxlen=max_samples)  # MAD window for error rate
        self._ewma_rate: float | None = None  # p0
        self._ewma_volume: float | None = None  # expected_volume

        self._frozen = False
        self._unfreeze_wall: float | None = None  # None = not cooling down

    # ---------------------------------------------------------------------- #
    #  Freeze control (called by engine on suspicion, spec §6.2)             #
    # ---------------------------------------------------------------------- #

    def freeze(self) -> None:
        """Freeze baseline updates immediately on suspicion of an anomaly.

        Called by the engine as soon as a raw gate is breached — before any
        consecutive-evaluation confirmation in the alert FSM.
        """
        self._frozen = True
        self._unfreeze_wall = None  # cancel any pending cooldown countdown

    def unfreeze(self) -> None:
        """Start the post-incident cooldown timer.

        The baseline will remain logically frozen until cooldown_seconds have
        elapsed (checked via is_frozen(now)).
        """
        self._frozen = False
        self._unfreeze_wall = time.monotonic() + self.cooldown_seconds

    @property
    def frozen(self) -> bool:
        """True if freeze() was called and unfreeze() has not yet been called."""
        return self._frozen

    def is_frozen(self, now: float | None = None) -> bool:
        """True if the baseline is frozen OR still within the post-incident cooldown."""
        if self._frozen:
            return True
        if self._unfreeze_wall is not None:
            wall = now if now is not None else time.monotonic()
            if wall < self._unfreeze_wall:
                return True
            self._unfreeze_wall = None  # cooldown elapsed; fully thawed
        return False

    # ---------------------------------------------------------------------- #
    #  Update                                                                 #
    # ---------------------------------------------------------------------- #

    def add(self, rate: float) -> None:
        """Legacy shim so existing tests calling b.add(rate) still work."""
        self._update_rate(rate)

    def update_rate(self, rate: float, *, volume_sufficient: bool = True) -> None:
        """Update rate baseline (EWMA + MAD) when volume is sufficient and not frozen."""
        if self.is_frozen() or not volume_sufficient:
            return
        self._update_rate(rate)

    def update_volume(self, volume_rate: float) -> None:
        """Update expected volume baseline (EWMA). Updated on every evaluation while unfrozen,
        including quiet ones (volume tracking is independent of error-rate sufficiency).
        """
        if self.is_frozen():
            return
        if self._ewma_volume is None:
            self._ewma_volume = volume_rate
        else:
            self._ewma_volume = self.alpha * volume_rate + (1.0 - self.alpha) * self._ewma_volume

    def _update_rate(self, rate: float) -> None:
        """Internal: update EWMA and MAD window for error rate."""
        if self._ewma_rate is None:
            self._ewma_rate = rate
        else:
            self._ewma_rate = self.alpha * rate + (1.0 - self.alpha) * self._ewma_rate
        self._obs.append(rate)

    # ---------------------------------------------------------------------- #
    #  Properties                                                             #
    # ---------------------------------------------------------------------- #

    @property
    def count(self) -> int:
        """Number of rate observations collected so far."""
        return len(self._obs)

    @property
    def ready(self) -> bool:
        """True once min_samples observations have been collected (legacy warm-up gate)."""
        return self.count >= self.min_samples

    @property
    def mean(self) -> float:
        """Rolling arithmetic mean of the error rate observations."""
        return statistics.fmean(self._obs) if self._obs else 0.0

    @property
    def p0(self) -> float:
        """EWMA-smoothed baseline error rate (p0 per spec §6.2)."""
        if self._ewma_rate is not None:
            return self._ewma_rate
        return self.mean

    @property
    def std(self) -> float:
        """Spread based on MAD (scaled by 1.4826) and observation variance, floored at sigma_floor."""
        if len(self._obs) < 2:
            return self.sigma_floor
        med = statistics.median(self._obs)
        mad = statistics.median([abs(x - med) for x in self._obs])
        s_mad = 1.4826 * mad
        s_dev = statistics.pstdev(self._obs)
        return max(s_mad, s_dev, self.sigma_floor)

    # Alias per spec
    sigma = std  # type: ignore[assignment]

    @property
    def expected_volume(self) -> float | None:
        """EWMA-smoothed expected lines/sec. None until the first update."""
        return self._ewma_volume
