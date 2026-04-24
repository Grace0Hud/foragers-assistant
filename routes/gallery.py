from flask import Blueprint, render_template, request, jsonify, session
from utils.audit import log_user_activity
from utils.db import photo_collection, serialize_doc
from utils.decorators import login_required
from utils.emailer import bug_report_email_enabled, send_abuse_report_email, send_bug_report_email
from utils.sanitize import (
    sanitize_coordinate,
    sanitize_issue_description,
    sanitize_issue_subject,
    sanitize_optional_email,
    parse_object_id,
    sanitize_tag,
)

gallery_bp = Blueprint("gallery", __name__)

# Shared projection for all photo queries
PHOTO_PROJECTION = {
    "_id":               1,
    "image":             1,
    "tags":              1,
    "location_label":    1,
    "manual_address":    1,
    "location_geo":      1,
    "nearest_road":      1,
    "address_not_found": 1,
    "uploaded_by":       1,
    "uploaded_at":       1,
}


@gallery_bp.route("/")
def start_index():
    return render_template("help.html", username=session.get("username"))


@gallery_bp.route("/gallery")
@login_required
def get_gallery():
    return render_template("gallery.html", username=session["username"])


@gallery_bp.route("/help")
def help_page():
    return render_template(
        "help.html",
        username=session.get("username"),
        bug_report_email_enabled=bug_report_email_enabled(),
    )


@gallery_bp.route("/help/report-issue", methods=["POST"])
def report_issue():
    previous_subject = request.form.get("subject", "")
    previous_email = request.form.get("contact_email", "")
    previous_description = request.form.get("description", "")

    try:
        subject = sanitize_issue_subject(previous_subject)
        reporter_email = sanitize_optional_email(previous_email)
        description = sanitize_issue_description(previous_description)
    except ValueError as exc:
        log_user_activity(
            "bug_report_failed",
            target_type="help",
            metadata={"reason": "validation_error"},
            success=False,
        )
        return render_template(
            "help.html",
            username=session.get("username"),
            bug_report_error=str(exc),
            bug_report_email_enabled=bug_report_email_enabled(),
            previous_issue_subject=previous_subject,
            previous_issue_email=previous_email,
            previous_issue_description=previous_description,
        ), 400

    try:
        send_bug_report_email(subject, description, reporter_email)
    except Exception:
        log_user_activity(
            "bug_report_failed",
            target_type="help",
            metadata={"reason": "email_send_failed"},
            success=False,
        )
        return render_template(
            "help.html",
            username=session.get("username"),
            bug_report_error="Bug report could not be sent right now. Please try again later.",
            bug_report_email_enabled=bug_report_email_enabled(),
            previous_issue_subject=subject,
            previous_issue_email=reporter_email,
            previous_issue_description=description,
        ), 500

    log_user_activity(
        "bug_report_submitted",
        target_type="help",
        metadata={"has_contact_email": bool(reporter_email)},
    )
    return render_template(
        "help.html",
        username=session.get("username"),
        bug_report_success="Thanks. Your issue report was sent.",
        bug_report_email_enabled=bug_report_email_enabled(),
    )


@gallery_bp.route("/gallery/feed")
@login_required
def api_feed():
    try:
        page  = max(1, int(request.args.get("page",  1)))
        limit = min(50, max(1, int(request.args.get("limit", 20))))
    except ValueError:
        return jsonify({"error": "Invalid pagination parameters"}), 400

    skip   = (page - 1) * limit
    cursor = (
        photo_collection
        .find({}, PHOTO_PROJECTION)
        .sort("uploaded_at", -1)
        .skip(skip)
        .limit(limit)
    )
    docs  = [serialize_doc(doc) for doc in cursor]
    total = photo_collection.count_documents({})

    return jsonify({
        "page":     page,
        "limit":    limit,
        "total":    total,
        "has_more": (skip + len(docs)) < total,
        "images":   docs,
    })


@gallery_bp.route("/gallery/search")
@login_required
def api_search():
    raw_tags = request.args.getlist("tags")
    if not raw_tags:
        log_user_activity("search_failed", target_type="gallery", metadata={"reason": "missing_tags"}, success=False)
        return jsonify({"error": "At least one tag is required"}), 400

    clean_tags = []
    for raw in raw_tags:
        try:
            clean_tags.append(sanitize_tag(raw.lower()))
        except ValueError:
            log_user_activity("search_failed", target_type="gallery", metadata={"reason": "invalid_tag"}, success=False)
            return jsonify({"error": f"Invalid tag: {raw}"}), 400

    docs = [
        serialize_doc(doc)
        for doc in photo_collection
            .find({"tags": {"$all": clean_tags}}, PHOTO_PROJECTION)
            .sort("uploaded_at", -1)
    ]
    log_user_activity(
        "search",
        target_type="gallery",
        metadata={"tag_count": len(clean_tags), "result_count": len(docs)},
    )
    return jsonify({"tags": clean_tags, "images": docs})


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    earth_radius_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    )
    return 2 * earth_radius_km * asin(sqrt(a))


@gallery_bp.route("/gallery/nearby")
@login_required
def api_nearby():
    try:
        user_lat = sanitize_coordinate(request.args.get("latitude", ""), -90.0, 90.0)
        user_lon = sanitize_coordinate(request.args.get("longitude", ""), -180.0, 180.0)
        radius_km = float(request.args.get("radius_km", "25"))
    except ValueError:
        log_user_activity(
            "nearby_filter_failed",
            target_type="gallery",
            metadata={"reason": "invalid_coordinates"},
            success=False,
        )
        return jsonify({"error": "Invalid location or radius"}), 400

    if not (0.1 <= radius_km <= 500):
        log_user_activity(
            "nearby_filter_failed",
            target_type="gallery",
            metadata={"reason": "invalid_radius"},
            success=False,
        )
        return jsonify({"error": "Radius must be between 0.1 and 500 km"}), 400

    raw_tags = request.args.getlist("tags")
    clean_tags = []
    for raw in raw_tags:
        try:
            clean_tags.append(sanitize_tag(raw.lower()))
        except ValueError:
            log_user_activity(
                "nearby_filter_failed",
                target_type="gallery",
                metadata={"reason": "invalid_tag"},
                success=False,
            )
            return jsonify({"error": f"Invalid tag: {raw}"}), 400

    query = {"location_geo.latitude": {"$ne": None}, "location_geo.longitude": {"$ne": None}}
    if clean_tags:
        query["tags"] = {"$all": clean_tags}

    docs = []
    for doc in photo_collection.find(query, PHOTO_PROJECTION).sort("uploaded_at", -1):
        geo = doc.get("location_geo") or {}
        lat = geo.get("latitude")
        lon = geo.get("longitude")
        if lat is None or lon is None:
            continue
        distance_km = _distance_km(user_lat, user_lon, float(lat), float(lon))
        if distance_km <= radius_km:
            safe_doc = serialize_doc(doc)
            safe_doc["distance_km"] = round(distance_km, 2)
            docs.append(safe_doc)

    log_user_activity(
        "nearby_filter",
        target_type="gallery",
        metadata={
            "tag_count": len(clean_tags),
            "radius_km": radius_km,
            "result_count": len(docs),
        },
    )
    return jsonify({"tags": clean_tags, "radius_km": radius_km, "images": docs})


@gallery_bp.route("/gallery/report-abuse", methods=["POST"])
@login_required
def report_abuse():
    data = request.get_json(silent=True) or {}
    raw_post_id = data.get("post_id", "")
    raw_reason = data.get("reason", "")

    oid = parse_object_id(raw_post_id)
    if not oid:
        log_user_activity(
            "abuse_report_failed",
            target_type="photo",
            target_id=raw_post_id,
            metadata={"reason": "invalid_post_id"},
            success=False,
        )
        return jsonify({"error": "Invalid post ID"}), 400

    try:
        reason = sanitize_issue_description(raw_reason)
    except ValueError as exc:
        log_user_activity(
            "abuse_report_failed",
            target_type="photo",
            target_id=raw_post_id,
            metadata={"reason": "invalid_description"},
            success=False,
        )
        return jsonify({"error": str(exc)}), 400

    post = photo_collection.find_one(
        {"_id": oid},
        {
            "_id": 1,
            "uploaded_by": 1,
            "image": 1,
            "tags": 1,
            "uploaded_at": 1,
            "location_label": 1,
        },
    )
    if not post:
        log_user_activity(
            "abuse_report_failed",
            target_type="photo",
            target_id=raw_post_id,
            metadata={"reason": "post_not_found"},
            success=False,
        )
        return jsonify({"error": "Post not found"}), 404

    try:
        send_abuse_report_email(
            reporter_username=session["username"],
            post_id=str(post["_id"]),
            reason=reason,
            uploader_username=post.get("uploaded_by", ""),
            image_name=post.get("image", ""),
            tags=post.get("tags", []),
            uploaded_at=post.get("uploaded_at").isoformat() if post.get("uploaded_at") else "",
            location_label=post.get("location_label", ""),
        )
    except Exception:
        log_user_activity(
            "abuse_report_failed",
            target_type="photo",
            target_id=str(post["_id"]),
            metadata={"reason": "email_send_failed"},
            success=False,
        )
        return jsonify({"error": "Abuse report could not be sent right now. Please try again later."}), 500

    log_user_activity(
        "abuse_report_submitted",
        target_type="photo",
        target_id=str(post["_id"]),
        metadata={"reported_user": post.get("uploaded_by", "")},
    )
    return jsonify({"ok": True})
