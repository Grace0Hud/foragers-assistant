from flask import *
from pymongo import MongoClient
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from functools import wraps
from bson import ObjectId
import os
import uuid
import re
import bleach
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
from datetime import datetime, timezone

# Loading environment variables.
load_dotenv()
MONGODB_URI = os.getenv("MONGODB_URI")
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER")
SECRET_KEY = os.getenv("SECRET_KEY")
SSL_CERT = os.getenv("SSL_CERT")
SSL_KEY = os.getenv("SSL_KEY")

# Connecting to the database.
client = MongoClient(MONGODB_URI)
db = client["user-data"]
photo_collection = db["user-photos"]
user_collection = db["user-login"]

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Auth helpers ──────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("signin_page"))
        return f(*args, **kwargs)
    return decorated


# ── Sanitization ──────────────────────────────────────────────────────────────

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
    v = bleach.clean(v, tags=[], strip=True)
    return v


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
    v = bleach.clean(v, tags=[], strip=True)
    return v


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
    v = bleach.clean(v, tags=[], strip=True)
    return v


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


# ── EXIF GPS extraction ───────────────────────────────────────────────────────

def _dms_to_decimal(dms_values, ref: str) -> float:
    def to_float(v):
        try:
            return float(v)
        except TypeError:
            return v[0] / v[1]
    deg = to_float(dms_values[0])
    mn  = to_float(dms_values[1])
    sec = to_float(dms_values[2])
    decimal = deg + mn / 60 + sec / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return round(decimal, 7)


def extract_exif_gps(filepath: str):
    try:
        img = Image.open(filepath)
        exif_data = img._getexif()
        if exif_data is None:
            return None
        gps_info = None
        for tag_id, val in exif_data.items():
            if TAGS.get(tag_id, tag_id) == "GPSInfo":
                gps_info = val
                break
        if not gps_info:
            return None
        gps = {GPSTAGS.get(k, k): v for k, v in gps_info.items()}
        if "GPSLatitude" not in gps or "GPSLongitude" not in gps:
            return None
        lat = _dms_to_decimal(gps["GPSLatitude"],  gps.get("GPSLatitudeRef",  "N"))
        lon = _dms_to_decimal(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
        return {"latitude": lat, "longitude": lon, "source": "exif"}
    except Exception:
        return None


# ── Shared doc serializer ─────────────────────────────────────────────────────

def serialize_doc(doc: dict) -> dict:
    """Convert a MongoDB document to a JSON-safe dict."""
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    if doc.get("uploaded_at"):
        doc["uploaded_at"] = doc["uploaded_at"].isoformat()
    return doc


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
@login_required
def start_index():
    return redirect(url_for("get_gallery"))


@app.route("/gallery")
@login_required
def get_gallery():
    return render_template("gallery.html", username=session["username"])


@app.route("/my-uploads")
@login_required
def my_uploads_page():
    return render_template("myuploads.html", username=session["username"])


@app.route("/my-uploads/feed")
@login_required
def api_my_uploads():
    """All posts by the current user, sorted newest-first."""
    projection = {
        "image":          1,
        "tags":           1,
        "location_label": 1,
        "manual_address": 1,
        "location_geo":   1,
        "uploaded_at":    1,
    }
    docs = [
        serialize_doc(doc)
        for doc in photo_collection
            .find({"uploaded_by": session["username"]}, projection)
            .sort("uploaded_at", -1)
    ]
    return jsonify({"images": docs})


@app.route("/my-uploads/delete/<doc_id>", methods=["DELETE"])
@login_required
def delete_upload(doc_id):
    """Delete a post and its image file. Only the owner can delete."""
    oid = parse_object_id(doc_id)
    if not oid:
        return jsonify({"error": "Invalid ID"}), 400

    doc = photo_collection.find_one(
        {"_id": oid, "uploaded_by": session["username"]},
        {"image": 1}
    )
    if not doc:
        return jsonify({"error": "Not found or not yours"}), 404

    # Delete image file from disk
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], doc["image"])
    if os.path.exists(filepath):
        os.remove(filepath)

    photo_collection.delete_one({"_id": oid})
    return jsonify({"ok": True})


@app.route("/my-uploads/edit-tags/<doc_id>", methods=["PATCH"])
@login_required
def edit_tags(doc_id):
    """Replace the tags list on a post. Only the owner can edit."""
    oid = parse_object_id(doc_id)
    if not oid:
        return jsonify({"error": "Invalid ID"}), 400

    data = request.get_json(silent=True) or {}
    raw_tags = data.get("tags", "")

    try:
        tag_list = sanitize_tags(raw_tags)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    result = photo_collection.update_one(
        {"_id": oid, "uploaded_by": session["username"]},
        {"$set": {"tags": tag_list}}
    )
    if result.matched_count == 0:
        return jsonify({"error": "Not found or not yours"}), 404

    return jsonify({"ok": True, "tags": tag_list})


@app.route("/gallery/feed")
@login_required
def api_feed():
    try:
        page  = max(1, int(request.args.get("page",  1)))
        limit = min(50, max(1, int(request.args.get("limit", 20))))
    except ValueError:
        return jsonify({"error": "Invalid pagination parameters"}), 400

    skip = (page - 1) * limit
    projection = {
        "_id":            0,
        "image":          1,
        "tags":           1,
        "location_label": 1,
        "manual_address": 1,
        "location_geo":   1,
        "uploaded_at":    1,
    }

    cursor = (
        photo_collection
        .find({}, projection)
        .sort("uploaded_at", -1)
        .skip(skip)
        .limit(limit)
    )

    docs = [serialize_doc(doc) for doc in cursor]
    total = photo_collection.count_documents({})
    return jsonify({
        "page":     page,
        "limit":    limit,
        "total":    total,
        "has_more": (skip + len(docs)) < total,
        "images":   docs,
    })


@app.route("/gallery/search")
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

    projection = {
        "_id":            0,
        "image":          1,
        "tags":           1,
        "location_label": 1,
        "manual_address": 1,
        "location_geo":   1,
        "uploaded_at":    1,
    }
    docs = [
        serialize_doc(doc)
        for doc in photo_collection
            .find({"tags": {"$all": clean_tags}}, projection)
            .sort("uploaded_at", -1)
    ]
    return jsonify({"tags": clean_tags, "images": docs})


@app.route("/uploads/<filename>")
@login_required
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/login", methods=["GET"])
def signin_page():
    if "username" in session:
        return redirect(url_for("get_gallery"))
    return render_template("signin.html")


@app.route("/login", methods=["POST"])
def user_login():
    try:
        username = sanitize_username(request.form.get("username", ""))
    except ValueError as e:
        return render_template("signin.html", error=str(e))
    try:
        password = sanitize_password(request.form.get("password", ""))
    except ValueError as e:
        return render_template("signin.html", error=str(e))

    user = user_collection.find_one({"username": username})
    if user is None or not check_password_hash(user.get("password", ""), password):
        return render_template("signin.html", error="Invalid username or password")

    session["username"] = username
    session.modified = True
    return redirect(url_for("get_gallery"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("signin_page"))


@app.route("/signup", methods=["GET"])
def signup_page():
    if "username" in session:
        return redirect(url_for("get_gallery"))
    return render_template("signup.html")


@app.route("/signup", methods=["POST"])
def user_signup():
    try:
        username = sanitize_username(request.form.get("username", ""))
    except ValueError as e:
        return render_template("signup.html", error=str(e),
                               previous_username=request.form.get("username", ""))
    try:
        password = sanitize_password(request.form.get("password", ""))
    except ValueError as e:
        return render_template("signup.html", error=str(e),
                               previous_username=username)

    confirm_password = request.form.get("confirm_password", "")
    if password != confirm_password:
        return render_template("signup.html", error="Passwords do not match.",
                               previous_username=username)

    existing = user_collection.find_one({"username": username})
    if existing is not None:
        return render_template("signup.html", error="That username is already taken.",
                               previous_username=username)

    hashed = generate_password_hash(password)
    user_collection.insert_one({"username": username, "password": hashed})
    session["username"] = username
    session.modified = True
    return redirect(url_for("get_gallery"))


@app.route("/upload", methods=["POST"])
@login_required
def upload_image():
    if "image" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["image"]

    try:
        tag_list = sanitize_tags(request.form.get("tags", ""))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        location_label = sanitize_location_label(request.form.get("location_label", ""))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        manual_address = sanitize_location_label(request.form.get("manual_address", ""))
    except ValueError:
        manual_address = ""

    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    filename = secure_filename(file.filename)
    filename = f"{uuid.uuid4().hex}_{filename}"
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    location_data = extract_exif_gps(filepath)

    if location_data is None:
        raw_lat = request.form.get("latitude", "").strip()
        raw_lon = request.form.get("longitude", "").strip()
        raw_src = request.form.get("geo_source", "").strip()
        if raw_lat and raw_lon:
            try:
                lat = sanitize_coordinate(raw_lat, -90.0,  90.0)
                lon = sanitize_coordinate(raw_lon, -180.0, 180.0)
                source = "browser" if raw_src == "browser" else "address" if raw_src == "address" else "unknown"
                location_data = {"latitude": lat, "longitude": lon, "source": source}
            except ValueError:
                location_data = None

    data = {
        "image":          filename,
        "tags":           tag_list,
        "location_label": location_label,
        "manual_address": manual_address,
        "location_geo":   location_data,
        "uploaded_by":    session["username"],
        "uploaded_at":    datetime.now(timezone.utc)
    }

    result = photo_collection.insert_one(data)
    print(f"Image uploaded. ID: {result.inserted_id} | tags: {tag_list} | geo: {location_data}")
    return jsonify({"ok": True, "id": str(result.inserted_id)}), 201


if __name__ == "__main__":
    env = os.getenv("FLASK_ENV", "development")
    if env == "production":
        app.run(host="0.0.0.0", port=5050)
    elif SSL_CERT and SSL_KEY:
        app.run(host="0.0.0.0", port=5050, ssl_context=(SSL_CERT, SSL_KEY))
    else:
        app.run(host="0.0.0.0", port=5050)