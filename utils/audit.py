from datetime import datetime, timezone
from hashlib import sha256

from flask import request, session

from utils.db import audit_collection, user_collection


def _hash_value(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def log_user_activity(action: str,
                      *,
                      target_type: str | None = None,
                      target_id: object | None = None,
                      metadata: dict | None = None,
                      username: str | None = None,
                      success: bool = True) -> None:
    """Write a best-effort audit record for meaningful user actions."""
    try:
        resolved_username = username or session.get("username")
        user_id = None

        if resolved_username:
            user = user_collection.find_one({"username": resolved_username}, {"_id": 1})
            if user is not None:
                user_id = user["_id"]

        remote_addr = request.headers.get("X-Forwarded-For", request.remote_addr or "")
        remote_addr = remote_addr.split(",")[0].strip()

        doc = {
            "timestamp": datetime.now(timezone.utc),
            "action": action,
            "success": success,
            "username": resolved_username,
            "user_id": user_id,
            "target_type": target_type,
            "target_id": str(target_id) if target_id is not None else None,
            "metadata": metadata or {},
            "ip_hash": _hash_value(remote_addr) if remote_addr else None,
            "user_agent": request.user_agent.string[:512] if request.user_agent.string else "",
        }

        audit_collection.insert_one(doc)
    except Exception:
        return
