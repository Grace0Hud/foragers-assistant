from hashlib import sha256


def hash_analytics_user_id(user_id: object) -> str:
    """Return a stable SHA-256 hash for analytics attribution."""
    return sha256(str(user_id).encode("utf-8")).hexdigest()
