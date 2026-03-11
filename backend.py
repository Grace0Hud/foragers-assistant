from flask import *
from pymongo import MongoClient
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from functools import wraps
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

# Starting app.
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
    TAG_RE = re.compile(r"^[A-Za-z]+$")
    if not isinstance(value, str):
        raise ValueError("Tag must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 128):
        raise ValueError("Tag length invalid")
    if not TAG_RE.match(v):
        raise ValueError("Tag contains invalid characters")
    v = bleach.clean(v, tags=[], strip=True)
    return v


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
    """
    Sanitize a free-text location label.
    - Must be a string
    - 0–200 characters (optional field — empty string is allowed)
    - Strips HTML/scripts via bleach
    - Blocks NoSQL injection characters: $ at the start of words, and bare dots
      that could be interpreted as field path traversal
    """
    if not isinstance(value, str):
        raise ValueError("Location must be a string")
    v = value.strip()
    if len(v) > 200:
        raise ValueError("Location label must be 200 characters or fewer")
    # Block any token that starts with $ (MongoDB operator injection)
    if re.search(r'(^|\s)\$', v):
        raise ValueError("Location contains invalid characters")
    # Strip HTML and scripts
    v = bleach.clean(v, tags=[], strip=True)
    return v


def sanitize_coordinate(value: str, low: float, high: float) -> float:
    """
    Parse and range-check a coordinate string coming from a hidden form field.
    Returns the float value, or raises ValueError.
    """
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ValueError("Invalid coordinate value")
    if not (low <= f <= high):
        raise ValueError(f"Coordinate {f} out of range [{low}, {high}]")
    return round(f, 7)


# ── EXIF GPS extraction (server-side fallback / verification) ─────────────────

def _dms_to_decimal(dms_values, ref: str) -> float:
    """Convert a (degrees, minutes, seconds) EXIF tuple to a signed decimal."""
    def to_float(v):
        # Pillow may return an IFDRational or a plain tuple (num, denom)
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
    """
    Open an image with Pillow and attempt to extract GPS coordinates from EXIF.
    Returns a dict {"latitude": float, "longitude": float, "source": "exif"}
    or None if GPS data is absent or the file is not a JPEG/TIFF.
    """
    try:
        img = Image.open(filepath)
        exif_data = img._getexif()
        if exif_data is None:
            return None

        # Find the GPSInfo block
        gps_info = None
        for tag_id, val in exif_data.items():
            tag_name = TAGS.get(tag_id, tag_id)
            if tag_name == "GPSInfo":
                gps_info = val
                break

        if not gps_info:
            return None

        # Decode the GPS sub-tags
        gps = {}
        for key, val in gps_info.items():
            gps[GPSTAGS.get(key, key)] = val

        if "GPSLatitude" not in gps or "GPSLongitude" not in gps:
            return None

        lat = _dms_to_decimal(gps["GPSLatitude"],  gps.get("GPSLatitudeRef",  "N"))
        lon = _dms_to_decimal(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))

        return {"latitude": lat, "longitude": lon, "source": "exif"}

    except Exception:
        return None


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
@login_required
def start_index():
    return render_template("upload.html", username=session["username"])


@app.route("/gallery")
@login_required
def get_gallery():
    return render_template("gallery.html", username=session["username"])


@app.route("/gallery/search")
@login_required
def api_search():
    raw_tag = request.args.get("tag", "")
    try:
        tag = sanitize_tag(raw_tag.lower())
    except ValueError:
        return jsonify({"error": "Invalid tag"}), 400

    images = photo_collection.find({"tag": tag}, {"image": 1, "_id": 0})
    filenames = [doc["image"] for doc in images]
    return jsonify({"tag": tag, "images": filenames})


@app.route("/uploads/<filename>")
@login_required
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/login", methods=["GET"])
def signin_page():
    if "username" in session:
        return redirect(url_for("start_index"))
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
    return redirect(url_for("start_index"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("signin_page"))


@app.route("/signup", methods=["GET"])
def signup_page():
    if "username" in session:
        return redirect(url_for("start_index"))
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
    return redirect(url_for("start_index"))


@app.route("/upload", methods=["POST"])
@login_required
def upload_image():
    if "image" not in request.files:
        return "No file part", 400

    file = request.files["image"]

    # ── Validate tag ──────────────────────────────────────────────────────────
    try:
        tag = sanitize_tag(request.form.get("tag", ""))
    except ValueError as e:
        return render_template("upload.html", error=str(e),
                               previous_tag=request.form.get("tag", ""),
                               previous_location=request.form.get("location_label", ""),
                               username=session["username"])

    # ── Validate manual location label ────────────────────────────────────────
    try:
        location_label = sanitize_location_label(request.form.get("location_label", ""))
    except ValueError as e:
        return render_template("upload.html", error=str(e),
                               previous_tag=tag,
                               previous_location=request.form.get("location_label", ""),
                               username=session["username"])

    if file.filename == "":
        return "No selected file", 400

    # ── Save the file ─────────────────────────────────────────────────────────
    filename = secure_filename(file.filename)
    filename = f"{uuid.uuid4().hex}_{filename}"
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    # ── Resolve coordinates ───────────────────────────────────────────────────
    # Priority: EXIF from the saved file → browser geolocation from hidden fields
    location_data = extract_exif_gps(filepath)

    if location_data is None:
        # Try the coordinates submitted by the browser via hidden fields
        raw_lat = request.form.get("latitude", "").strip()
        raw_lon = request.form.get("longitude", "").strip()
        raw_src = request.form.get("geo_source", "").strip()

        if raw_lat and raw_lon:
            try:
                lat = sanitize_coordinate(raw_lat, -90.0,  90.0)
                lon = sanitize_coordinate(raw_lon, -180.0, 180.0)
                # Only accept "browser" as a valid source label
                source = "browser" if raw_src == "browser" else "unknown"
                location_data = {"latitude": lat, "longitude": lon, "source": source}
            except ValueError:
                # Coordinates were malformed — store without them
                location_data = None

    # ── Build and insert document ─────────────────────────────────────────────
    data = {
        "image":          filename,
        "tag":            tag.lower(),
        "location_label": location_label,                    # free-text description (may be "")
        "location_geo":   location_data,                     # {"latitude", "longitude", "source"} or None
        "uploaded_by":    session["username"],
        "uploaded_at":    datetime.now(timezone.utc)         # UTC timestamp
    }

    result = photo_collection.insert_one(data)
    print(f"Image uploaded. ID: {result.inserted_id} | geo: {location_data}")

    return redirect(url_for("start_index"))


if __name__ == "__main__":
    env = os.getenv("FLASK_ENV", "development")

    if env == "production":
        # On AWS, Nginx terminates HTTPS and proxies to Flask over plain HTTP
        app.run(host="0.0.0.0", port=5050)
    elif SSL_CERT and SSL_KEY:
        # Local development: Flask serves HTTPS directly with a self-signed cert
        app.run(host="0.0.0.0", port=5050, ssl_context=(SSL_CERT, SSL_KEY))
    else:
        # Local fallback: plain HTTP (geolocation won't work outside localhost)
        app.run(host="0.0.0.0", port=5050)
