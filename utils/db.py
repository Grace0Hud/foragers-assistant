from pymongo import ASCENDING, MongoClient
from pymongo.errors import OperationFailure
from utils.config import Config

client = MongoClient(Config.MONGODB_URI)
_db = client["user-data"]

photo_collection = _db[Config.PHOTO_COLLECTION]
user_collection  = _db["user-login"]

try:
    user_collection.create_index([("username", ASCENDING)], unique=True, name="unique_username")
except OperationFailure as exc:
    raise RuntimeError(
        "Failed to enforce unique usernames. Resolve duplicate usernames in the "
        "'user-login' collection, then restart the app."
    ) from exc


def serialize_doc(doc: dict) -> dict:
    """Convert a MongoDB document to a JSON-safe dict."""
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    if doc.get("uploaded_at"):
        doc["uploaded_at"] = doc["uploaded_at"].isoformat()
    return doc
