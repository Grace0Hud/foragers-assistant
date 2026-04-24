from flask import (Blueprint, request, jsonify, session,
                   send_from_directory, current_app)
from werkzeug.utils import secure_filename
from datetime import datetime, timezone
from utils.audit import log_user_activity
from utils.db import photo_collection
from utils.decorators import login_required
from utils.sanitize import sanitize_tags, sanitize_location_label, sanitize_coordinate
from utils.geo import extract_exif_gps, lookup_nearest_road
import os
import uuid

uploads_bp = Blueprint("uploads", __name__)


@uploads_bp.route("/uploads/<filename>")
@login_required
def uploaded_file(filename):
    return send_from_directory(current_app.config["UPLOAD_FOLDER"], filename)


@uploads_bp.route("/upload", methods=["POST"])
@login_required
def upload_image():
    if "image" not in request.files:
        log_user_activity("upload_failed", target_type="photo", metadata={"reason": "missing_file_part"}, success=False)
        return jsonify({"error": "No file part"}), 400

    file = request.files["image"]

    try:
        tag_list = sanitize_tags(request.form.get("tags", ""))
    except ValueError as e:
        log_user_activity("upload_failed", target_type="photo", metadata={"reason": "invalid_tags"}, success=False)
        return jsonify({"error": str(e)}), 400

    try:
        location_label = sanitize_location_label(request.form.get("location_label", ""))
    except ValueError as e:
        log_user_activity("upload_failed", target_type="photo", metadata={"reason": "invalid_location_label"}, success=False)
        return jsonify({"error": str(e)}), 400

    try:
        manual_address = sanitize_location_label(request.form.get("manual_address", ""))
    except ValueError:
        manual_address = ""

    if file.filename == "":
        log_user_activity("upload_failed", target_type="photo", metadata={"reason": "empty_filename"}, success=False)
        return jsonify({"error": "No selected file"}), 400

    # Save file
    filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
    filepath = os.path.join(current_app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    # Resolve coordinates — EXIF first, then browser/address submission
    location_data = extract_exif_gps(filepath)
    address_not_found = False

    if location_data is None:
        raw_lat = request.form.get("latitude",  "").strip()
        raw_lon = request.form.get("longitude", "").strip()
        raw_src = request.form.get("geo_source","").strip()
        if raw_lat and raw_lon:
            try:
                lat = sanitize_coordinate(raw_lat, -90.0,   90.0)
                lon = sanitize_coordinate(raw_lon, -180.0, 180.0)
                source = (
                    "browser" if raw_src == "browser" else
                    "address" if raw_src == "address" else
                    "unknown"
                )
                location_data = {"latitude": lat, "longitude": lon, "source": source}
            except ValueError:
                location_data = None

        # Explicit flag set by JS when Nominatim returned no results
        if request.form.get("address_lookup_failed", "").strip() == "1":
            address_not_found = True

    address_not_found = location_data is None

    print(f"DEBUG form keys: {list(request.form.keys())}")
    print(f"DEBUG address_lookup_failed: '{request.form.get('address_lookup_failed', 'NOT PRESENT')}'")
    print(f"DEBUG address_not_found: {address_not_found}")

    # Road proximity lookup
    nearest_road = None
    if location_data and location_data.get("latitude") is not None:
        try:
            nearest_road = lookup_nearest_road(
                float(location_data["latitude"]),
                float(location_data["longitude"]),
            )
        except Exception as e:
            print(f"Road lookup failed: {e}")

    doc = {
        "image":             filename,
        "tags":              tag_list,
        "location_label":    location_label,
        "manual_address":    manual_address,
        "location_geo":      location_data,
        "nearest_road":      nearest_road,
        "address_not_found": address_not_found,
        "uploaded_by":       session["username"],
        "uploaded_at":       datetime.now(timezone.utc),
    }

    result = photo_collection.insert_one(doc)
    log_user_activity(
        "upload_created",
        target_type="photo",
        target_id=result.inserted_id,
        metadata={
            "photo_id": str(result.inserted_id),
            "tag_count": len(tag_list),
            "has_location_label": bool(location_label),
            "has_manual_address": bool(manual_address),
            "has_location_geo": location_data is not None,
            "geo_source": location_data.get("source") if location_data else None,
            "address_not_found": address_not_found,
            "has_nearest_road": nearest_road is not None,
        },
    )
    print(f"Uploaded {filename}")
    print(f"  tags:         {tag_list}")
    print(f"  location_geo: {location_data}")
    print(f"  nearest_road: {nearest_road}")
    return jsonify({"ok": True, "id": str(result.inserted_id)}), 201
