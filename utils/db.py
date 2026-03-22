from pymongo import MongoClient
from utils.config import Config

client = MongoClient(Config.MONGODB_URI)
_db = client["user-data"]

photo_collection = _db["user-photos"]
user_collection  = _db["user-login"]


def serialize_doc(doc: dict) -> dict:
    """Convert a MongoDB document to a JSON-safe dict."""
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    if doc.get("uploaded_at"):
        doc["uploaded_at"] = doc["uploaded_at"].isoformat()
    return doc