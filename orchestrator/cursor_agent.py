import time, random, logging
from typing import Callable, Any, Optional

class RetryableError(Exception):
    pass

class RateLimitError(Exception):
    pass

class TransportError(Exception):
    pass

def _default_should_retry(exc: Exception) -> bool:
    emsg = str(exc).lower()
    retryable_patterns = (
        "timeout", "timed out", "connection reset", "temporarily unavailable",
        "rate limit", "too many requests", "429", "5xx", "internal server error"
    )
    return any(p in emsg for p in retryable_patterns) or isinstance(
        exc, (RetryableError, RateLimitError, TransportError)
    )

def call_cursor_with_retry(
    fn: Callable[[], Any],
    *,
    max_attempts: int = 6,
    base_delay: float = 1.0,
    cap_delay: float = 30.0,
    should_retry: Optional[Callable[[Exception], bool]] = None,
    on_retry: Optional[Callable[[int, Exception, float], None]] = None,
) -> Any:
    """Exponential backoff + jitter around the cursor-agent transport."""
    should_retry = should_retry or _default_should_retry
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as e:
            attempt += 1
            if attempt >= max_attempts or not should_retry(e):
                raise
            delay = min(cap_delay, base_delay * (2 ** (attempt - 1)))
            delay *= (1.0 + random.random() * 0.25)  # add jitter
            if on_retry:
                try:
                    on_retry(attempt, e, delay)
                except Exception:
                    pass
            logging.warning(
                "cursor-agent call failed (%s). retry %d/%d in %.1fs",
                e, attempt, max_attempts, delay
            )
            time.sleep(delay)
