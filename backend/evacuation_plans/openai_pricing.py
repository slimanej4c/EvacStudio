import os
from decimal import Decimal, ROUND_HALF_UP


PRICE_CURRENCY = os.environ.get("OPENAI_PRICE_CURRENCY", "USD")
LOCAL_MODES = {"local", "local_walls"}
OPENAI_MODE_ENV_PREFIXES = {
    "sketch_to_plan": "OPENAI_SKETCH",
    "existing_plan_cleanup": "OPENAI_EXISTING_PLAN",
}
QUALITY_LEVELS = {"low", "medium", "high"}


def _env_decimal(name, default):
    raw_value = os.environ.get(name)
    if raw_value is None:
        return Decimal(str(default))
    try:
        return Decimal(str(raw_value))
    except Exception:
        return Decimal(str(default))


def _money(value):
    return float(Decimal(value).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def _base_range(cleaning_mode, quality):
    if cleaning_mode in LOCAL_MODES:
        return Decimal("0"), Decimal("0")
    if cleaning_mode not in OPENAI_MODE_ENV_PREFIXES:
        raise ValueError("unknown_cleaning_mode")
    if quality not in QUALITY_LEVELS:
        raise ValueError("unknown_quality")

    defaults = {
        "low": ("0.01", "0.03"),
        "medium": ("0.05", "0.10"),
        "high": ("0.18", "0.30"),
    }
    default_min, default_max = defaults[quality]
    prefix = OPENAI_MODE_ENV_PREFIXES[cleaning_mode]
    quality_key = quality.upper()
    return (
        _env_decimal(f"{prefix}_{quality_key}_MIN", default_min),
        _env_decimal(f"{prefix}_{quality_key}_MAX", default_max),
    )


def estimate_cleaning_cost(
    cleaning_mode: str,
    quality: str,
    output_size: str,
    verification_enabled: bool = False,
    max_automatic_corrections: int = 0,
) -> dict:
    quality = (quality or "medium").lower()
    cleaning_mode = cleaning_mode or "local"
    output_size = output_size or "auto"
    correction_count = max(0, int(max_automatic_corrections or 0))

    base_min, base_max = _base_range(cleaning_mode, quality)
    generation_count_max = 0 if cleaning_mode in LOCAL_MODES else 1 + correction_count
    estimated_min = base_min * (1 + correction_count)
    estimated_max = base_max * (1 + correction_count)

    if verification_enabled and cleaning_mode not in LOCAL_MODES:
        estimated_min += _env_decimal("OPENAI_VERIFICATION_MIN", "0.002")
        estimated_max += _env_decimal("OPENAI_VERIFICATION_MAX", "0.02")

    return {
        "currency": PRICE_CURRENCY,
        "estimated_min": _money(estimated_min),
        "estimated_max": _money(estimated_max),
        "is_estimate": True,
        "details": {
            "analysis": cleaning_mode not in LOCAL_MODES,
            "generation_count_max": generation_count_max,
            "verification": bool(verification_enabled and cleaning_mode not in LOCAL_MODES),
            "quality": quality,
            "output_size": output_size,
            "cleaning_mode": cleaning_mode,
            "max_automatic_corrections": correction_count,
        },
    }
