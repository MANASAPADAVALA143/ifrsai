"""Runtime macro sensitivity configuration for IFRS 9."""

# Single source of truth for macro sensitivity defaults
# Loaded at startup; overridden by DB values when available
MACRO_SENSITIVITY_DEFAULTS = {
    "gdp_sensitivity": 0.15,
    "unemployment_sensitivity": 0.08,
    "interest_rate_sensitivity": 0.03,
}

_runtime_config = dict(MACRO_SENSITIVITY_DEFAULTS)  # mutable at runtime
_db_loaded = False


def get_sensitivity(key: str) -> float:
    return _runtime_config.get(key, MACRO_SENSITIVITY_DEFAULTS[key])


def update_sensitivity(key: str, value: float):
    global _db_loaded
    if key not in MACRO_SENSITIVITY_DEFAULTS:
        raise ValueError(f"Unknown sensitivity key: {key}")
    _runtime_config[key] = value
    _db_loaded = True


def set_db_loaded(value: bool):
    global _db_loaded
    _db_loaded = value


def is_db_loaded() -> bool:
    return _db_loaded


def get_all_sensitivities() -> dict:
    return dict(_runtime_config)


def reset_to_defaults():
    global _db_loaded
    _runtime_config.update(MACRO_SENSITIVITY_DEFAULTS)
    _db_loaded = False
