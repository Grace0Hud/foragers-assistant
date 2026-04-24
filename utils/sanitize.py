import re
import bleach
from bson import ObjectId


def sanitize_field_key(key: str) -> str:
    if key.startswith("$") or "." in key:
        raise ValueError("Invalid field name")
    return key


def sanitize_tag(value: str) -> str:
    TAG_RE = re.compile(r"^[A-Za-z ]+$")
    if not isinstance(value, str):
        raise ValueError("Tag must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 128):
        raise ValueError("Tag length invalid")
    if not TAG_RE.match(v):
        raise ValueError("Tag contains invalid characters")
    return bleach.clean(v, tags=[], strip=True)


def sanitize_tags(raw: str) -> list:
    if not isinstance(raw, str):
        raise ValueError("Tags must be a string")
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    if len(parts) == 0:
        raise ValueError("Please add at least one tag")
    if len(parts) > 10:
        raise ValueError("A maximum of 10 tags is allowed")
    seen = []
    for part in parts:
        cleaned = sanitize_tag(part)
        if cleaned not in seen:
            seen.append(cleaned)
    return seen


def sanitize_username(value: str) -> str:
    USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
    if not isinstance(value, str):
        raise ValueError("Username must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 64):
        raise ValueError("Username must be between 1 and 64 characters")
    if not USERNAME_RE.match(v):
        raise ValueError("Username may only contain letters, numbers, underscores, and hyphens")
    return bleach.clean(v, tags=[], strip=True)


def sanitize_password(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Password must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 128):
        raise ValueError("Password must be between 1 and 128 characters")
    return v


def sanitize_location_label(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Location must be a string")
    v = value.strip()
    if len(v) > 200:
        raise ValueError("Location label must be 200 characters or fewer")
    if re.search(r'(^|\s)\$', v):
        raise ValueError("Location contains invalid characters")
    return bleach.clean(v, tags=[], strip=True)


def sanitize_optional_email(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Email must be a string")
    v = value.strip()
    if not v:
        return ""
    if len(v) > 254:
        raise ValueError("Email must be 254 characters or fewer")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
        raise ValueError("Please enter a valid email address")
    return bleach.clean(v, tags=[], strip=True)


def sanitize_issue_subject(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Subject must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 120):
        raise ValueError("Subject must be between 1 and 120 characters")
    return bleach.clean(v, tags=[], strip=True)


def sanitize_issue_description(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Description must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 4000):
        raise ValueError("Description must be between 1 and 4000 characters")
    return bleach.clean(v, tags=[], strip=True)


def sanitize_coordinate(value: str, low: float, high: float) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ValueError("Invalid coordinate value")
    if not (low <= f <= high):
        raise ValueError(f"Coordinate {f} out of range [{low}, {high}]")
    return round(f, 7)


def parse_object_id(id_str: str):
    """Safely parse a MongoDB ObjectId string; returns None if invalid."""
    try:
        return ObjectId(id_str)
    except Exception:
        return None
