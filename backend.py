from flask import *
from pymongo import MongoClient
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import os
import uuid
import re
import bleach

#loading enviornment variables.
load_dotenv()
MONGODB_URI = os.getenv("MONGODB_URI")
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER")

#connecting to the database. 
client = MongoClient(MONGODB_URI)
db = client["user-photos"]
collection = db["user-data"]
#starting app.
app = Flask(__name__)
#configuring upload folder for images.
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
# Create folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def sanitize_field_key(key: str) -> str:
    #sanitizing a single key. 
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
    # remove HTML and scripts
    v = bleach.clean(v, tags=[], strip=True)
    return v


@app.route("/")
def start_index():
	return render_template("index.html")

@app.route("/gallery")
def get_gallery():
    return render_template("gallery.html")

@app.route("/gallery/search")
def api_search():
    print("searching!")
    tag = request.args.get("tag", "")
    images = collection.find({"tag": tag}, {"image": 1, "_id": 0})
    filenames = [doc["image"] for doc in images]
    return jsonify({"tag": tag, "images": filenames})

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

#used to get a user iamge from the form. 
@app.route("/upload", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return "No file part", 400

    file = request.files["image"]
    try:
        tag = sanitize_tag(request.form.get("tag", ""))
    except ValueError as e:
        # Re-render form with error message
        print("Not a valid tag!")
        #display error message on the page. 
        return render_template(
            "index.html",
            error=str(e),
            previous_tag=request.form.get("tag", "")
        )

    if file.filename == "":
        return "No selected file", 400
    
	#ensure that the file name is not malicious
    filename = secure_filename(file.filename)
    #then tack on an additional identifier so duplicate names aren't a problem. 
    filename = f"{uuid.uuid4().hex}_{filename}"
    #save file to local path. 
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)
    
	#add image and tag to db. 
    data = {
	"image": filename,
    "tag": tag
    }
    result = collection.insert_one(data)
    print(f"Image Path uploaded. ID: \n {result.inserted_id}")
    return redirect(url_for("start_index")), 200

#start up app.
app.run(host = "0.0.0.0", port=5050)