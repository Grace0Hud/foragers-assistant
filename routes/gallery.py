from flask import Blueprint, render_template, request, jsonify, session
from utils.db import photo_collection, serialize_doc
from utils.decorators import login_required
from utils.sanitize import sanitize_tag

gallery_bp = Blueprint("gallery", __name__)

# Shared projection for all photo queries
PHOTO_PROJECTION = {
    "_id":               0,
    "image":             1,
    "tags":              1,
    "location_label":    1,
    "manual_address":    1,
    "location_geo":      1,
    "nearest_road":      1,
    "address_not_found": 1,
    "uploaded_at":       1,
}


@gallery_bp.route("/")
@login_required
def start_index():
    from flask import redirect, url_for
    return redirect(url_for("gallery.get_gallery"))


@gallery_bp.route("/gallery")
@login_required
def get_gallery():
    return render_template("gallery.html", username=session["username"])


@gallery_bp.route("/help")
@login_required
def help_page():
    return render_template("help.html", username=session["username"])


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
        return jsonify({"error": "At least one tag is required"}), 400

    clean_tags = []
    for raw in raw_tags:
        try:
            clean_tags.append(sanitize_tag(raw.lower()))
        except ValueError:
            return jsonify({"error": f"Invalid tag: {raw}"}), 400

    docs = [
        serialize_doc(doc)
        for doc in photo_collection
            .find({"tags": {"$all": clean_tags}}, PHOTO_PROJECTION)
            .sort("uploaded_at", -1)
    ]
    return jsonify({"tags": clean_tags, "images": docs})