from flask import (Blueprint, render_template, request,
                   jsonify, session, current_app)
from utils.audit import log_user_activity
from utils.db import photo_collection, serialize_doc
from utils.decorators import login_required
from utils.sanitize import sanitize_tags, sanitize_location_label, parse_object_id
from utils.geo import lookup_nearest_road
import os

my_uploads_bp = Blueprint("my_uploads", __name__)

MY_UPLOADS_PROJECTION = {
    "image":             1,
    "tags":              1,
    "location_label":    1,
    "manual_address":    1,
    "location_geo":      1,
    "nearest_road":      1,
    "address_not_found": 1,
    "uploaded_at":       1,
}


@my_uploads_bp.route("/my-uploads")
@login_required
def my_uploads_page():
    return render_template("myuploads.html", username=session["username"])


@my_uploads_bp.route("/my-uploads/feed")
@login_required
def api_my_uploads():
    """All posts by the current user, sorted newest-first."""
    docs = [
        serialize_doc(doc)
        for doc in photo_collection
            .find({"uploaded_by": session["username"]}, MY_UPLOADS_PROJECTION)
            .sort("uploaded_at", -1)
    ]
    return jsonify({"images": docs})


@my_uploads_bp.route("/my-uploads/delete/<doc_id>", methods=["DELETE"])
@login_required
def delete_upload(doc_id):
    """Delete a post and its image file. Only the owner may delete."""
    oid = parse_object_id(doc_id)
    if not oid:
        log_user_activity("upload_delete_failed", target_type="photo", target_id=doc_id, metadata={"reason": "invalid_id"}, success=False)
        return jsonify({"error": "Invalid ID"}), 400

    doc = photo_collection.find_one(
        {"_id": oid, "uploaded_by": session["username"]},
        {"image": 1, "tags": 1, "location_geo": 1, "manual_address": 1, "location_label": 1}
    )
    if not doc:
        log_user_activity("upload_delete_failed", target_type="photo", target_id=oid, metadata={"reason": "not_found_or_not_owner"}, success=False)
        return jsonify({"error": "Not found or not yours"}), 404

    # Remove image from disk
    filepath = os.path.join(current_app.config["UPLOAD_FOLDER"], doc["image"])
    if os.path.exists(filepath):
        os.remove(filepath)

    photo_collection.delete_one({"_id": oid})
    log_user_activity(
        "upload_deleted",
        target_type="photo",
        target_id=oid,
        metadata={
            "tag_count": len(doc.get("tags", [])),
            "had_location_geo": doc.get("location_geo") is not None,
            "had_manual_address": bool(doc.get("manual_address")),
            "had_location_label": bool(doc.get("location_label")),
        },
    )
    return jsonify({"ok": True})


@my_uploads_bp.route("/my-uploads/edit-tags/<doc_id>", methods=["PATCH"])
@login_required
def edit_tags(doc_id):
    """Replace the tags on a post. Only the owner may edit."""
    oid = parse_object_id(doc_id)
    if not oid:
        log_user_activity("upload_edit_tags_failed", target_type="photo", target_id=doc_id, metadata={"reason": "invalid_id"}, success=False)
        return jsonify({"error": "Invalid ID"}), 400

    data = request.get_json(silent=True) or {}
    try:
        tag_list = sanitize_tags(data.get("tags", ""))
    except ValueError as e:
        log_user_activity("upload_edit_tags_failed", target_type="photo", target_id=oid, metadata={"reason": "invalid_tags"}, success=False)
        return jsonify({"error": str(e)}), 400

    result = photo_collection.update_one(
        {"_id": oid, "uploaded_by": session["username"]},
        {"$set": {"tags": tag_list}}
    )
    if result.matched_count == 0:
        log_user_activity("upload_edit_tags_failed", target_type="photo", target_id=oid, metadata={"reason": "not_found_or_not_owner"}, success=False)
        return jsonify({"error": "Not found or not yours"}), 404

    log_user_activity(
        "upload_edited_tags",
        target_type="photo",
        target_id=oid,
        metadata={"tag_count": len(tag_list)},
    )
    return jsonify({"ok": True, "tags": tag_list})


@my_uploads_bp.route("/my-uploads/edit-location/<doc_id>", methods=["PATCH"])
@login_required
def edit_location(doc_id):
    """Update address, location label, and re-run road lookup. Owner only."""
    oid = parse_object_id(doc_id)
    if not oid:
        log_user_activity("upload_edit_location_failed", target_type="photo", target_id=doc_id, metadata={"reason": "invalid_id"}, success=False)
        return jsonify({"error": "Invalid ID"}), 400

    data = request.get_json(silent=True) or {}

    try:
        manual_address = sanitize_location_label(data.get("manual_address", ""))
    except ValueError as e:
        log_user_activity("upload_edit_location_failed", target_type="photo", target_id=oid, metadata={"reason": "invalid_manual_address"}, success=False)
        return jsonify({"error": str(e)}), 400

    try:
        location_label = sanitize_location_label(data.get("location_label", ""))
    except ValueError as e:
        log_user_activity("upload_edit_location_failed", target_type="photo", target_id=oid, metadata={"reason": "invalid_location_label"}, success=False)
        return jsonify({"error": str(e)}), 400

    # Geocode the new address if one was provided
    location_geo      = None
    nearest_road      = None
    address_not_found = False

    if manual_address:
        lat = data.get("latitude")
        lon = data.get("longitude")
        if lat is not None and lon is not None:
            location_geo = {
                "latitude":  round(float(lat), 7),
                "longitude": round(float(lon), 7),
                "source":    "address",
            }
            address_not_found = False  # explicitly clear — geocoding succeeded
        else:
            address_not_found = True   # address entered but coords not found

        if location_geo:
            try:
                nearest_road = lookup_nearest_road(
                    location_geo["latitude"], location_geo["longitude"]
                )
            except Exception as e:
                print(f"Road lookup failed: {e}")

    address_not_found = location_geo is None

    updates = {
        "manual_address":    manual_address,
        "location_label":    location_label,
        "location_geo":      location_geo,
        "nearest_road":      nearest_road,
        "address_not_found": address_not_found,
    }

    result = photo_collection.update_one(
        {"_id": oid, "uploaded_by": session["username"]},
        {"$set": updates}
    )
    if result.matched_count == 0:
        log_user_activity("upload_edit_location_failed", target_type="photo", target_id=oid, metadata={"reason": "not_found_or_not_owner"}, success=False)
        return jsonify({"error": "Not found or not yours"}), 404

    log_user_activity(
        "upload_edited_location",
        target_type="photo",
        target_id=oid,
        metadata={
            "has_manual_address": bool(manual_address),
            "has_location_label": bool(location_label),
            "has_location_geo": location_geo is not None,
            "address_not_found": address_not_found,
            "has_nearest_road": nearest_road is not None,
        },
    )
    return jsonify({"ok": True, **updates})
