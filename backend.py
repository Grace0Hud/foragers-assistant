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

# Loading environment variables.
load_dotenv()
MONGODB_URI = os.getenv("MONGODB_URI")
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER")
SECRET_KEY = os.getenv("SECRET_KEY")

# Connecting to the database.
client = MongoClient(MONGODB_URI)
db = client["user-data"]
photo_collection = db["user-photos"]
user_collection = db["user-login"]

# Starting app.
app = Flask(__name__)
# Secret key is required for Flask session signing.
# Set SECRET_KEY in your .env file to a long random string.
app.config["SECRET_KEY"] = SECRET_KEY
# Configuring upload folder for images.
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
# Create folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Auth helpers ──────────────────────────────────────────────────────────────

def login_required(f):
    """
    Decorator that redirects unauthenticated users to the sign-in page.
    Attach to any route that requires a logged-in session.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("signin_page"))
        return f(*args, **kwargs)
    return decorated


# ── Sanitization ──────────────────────────────────────────────────────────────

def sanitize_field_key(key: str) -> str:
    # Sanitizing a single key.
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
    # Remove HTML and scripts
    v = bleach.clean(v, tags=[], strip=True)
    return v


def sanitize_username(value: str) -> str:
    """
    Sanitize a username:
    - Must be a non-empty string
    - Alphanumeric characters, underscores, and hyphens only
    - Length between 1 and 64 characters
    - Strip any HTML/scripts
    """
    USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
    if not isinstance(value, str):
        raise ValueError("Username must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 64):
        raise ValueError("Username must be between 1 and 64 characters")
    if not USERNAME_RE.match(v):
        raise ValueError("Username may only contain letters, numbers, underscores, and hyphens")
    # Strip any residual HTML
    v = bleach.clean(v, tags=[], strip=True)
    return v


def sanitize_password(value: str) -> str:
    """
    Sanitize a password:
    - Must be a non-empty string
    - Length between 1 and 128 characters
    - No structural validation beyond length (passwords are hashed server-side)
    """
    if not isinstance(value, str):
        raise ValueError("Password must be a string")
    v = value.strip()
    if not (1 <= len(v) <= 128):
        raise ValueError("Password must be between 1 and 128 characters")
    return v


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
    print("searching!")
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
    # If already logged in, skip the sign-in page entirely
    if "username" in session:
        return redirect(url_for("start_index"))
    return render_template("signin.html")


@app.route("/login", methods=["POST"])
def user_login():
    # Sanitize and validate inputs
    try:
        username = sanitize_username(request.form.get("username", ""))
    except ValueError as e:
        return render_template("signin.html", error=str(e))

    try:
        password = sanitize_password(request.form.get("password", ""))
    except ValueError as e:
        return render_template("signin.html", error=str(e))

    # Look up user in the database (exact match only — no regex, no operators)
    user = user_collection.find_one({"username": username})

    # Use a generic error to avoid leaking whether the username exists
    if user is None or not check_password_hash(user.get("password", ""), password):
        return render_template("signin.html", error="Invalid username or password")

    # Store the username in the server-side session cookie
    session["username"] = username
    # Mark session as modified to ensure it is saved
    session.modified = True

    return redirect(url_for("start_index"))


@app.route("/logout")
def logout():
    # Clear the entire session and redirect to sign-in
    session.clear()
    return redirect(url_for("signin_page"))


@app.route("/signup", methods=["GET"])
def signup_page():
    # If already logged in, skip signup
    if "username" in session:
        return redirect(url_for("start_index"))
    return render_template("signup.html")


@app.route("/signup", methods=["POST"])
def user_signup():
    # Sanitize and validate username
    try:
        username = sanitize_username(request.form.get("username", ""))
    except ValueError as e:
        return render_template("signup.html", error=str(e),
                               previous_username=request.form.get("username", ""))

    # Sanitize and validate password
    try:
        password = sanitize_password(request.form.get("password", ""))
    except ValueError as e:
        return render_template("signup.html", error=str(e),
                               previous_username=username)

    # Confirm password matches
    confirm_password = request.form.get("confirm_password", "")
    if password != confirm_password:
        return render_template("signup.html", error="Passwords do not match.",
                               previous_username=username)

    # Check username is not already taken (exact match, no operators)
    existing = user_collection.find_one({"username": username})
    if existing is not None:
        return render_template("signup.html", error="That username is already taken.",
                               previous_username=username)

    # Hash the password before storing — never store plaintext passwords
    hashed = generate_password_hash(password)

    user_collection.insert_one({"username": username, "password": hashed})
    print(f"New user registered: {username}")

    # Log the new user in immediately after signup
    session["username"] = username
    session.modified = True

    return redirect(url_for("start_index"))


# Used to get a user image from the form.
@app.route("/upload", methods=["POST"])
@login_required
def upload_image():
    if "image" not in request.files:
        return "No file part", 400

    file = request.files["image"]
    try:
        tag = sanitize_tag(request.form.get("tag", ""))
    except ValueError as e:
        print("Not a valid tag!")
        return render_template(
            "upload.html",
            error=str(e),
            previous_tag=request.form.get("tag", ""),
            username=session["username"]
        )

    if file.filename == "":
        return "No selected file", 400

    # Ensure that the file name is not malicious
    filename = secure_filename(file.filename)
    # Tack on an additional identifier so duplicate names aren't a problem.
    filename = f"{uuid.uuid4().hex}_{filename}"
    # Save file to local path.
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    # Add image and tag to db.
    data = {
        "image": filename,
        "tag": tag.lower()
    }
    result = photo_collection.insert_one(data)
    print(f"Image Path uploaded. ID: \n {result.inserted_id}")
    return redirect(url_for("start_index"))


if __name__ == "__main__":
    # Start up app.
    app.run(host="0.0.0.0", port=5050)
