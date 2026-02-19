from flask import Flask, render_template, request
from pymongo import MongoClient
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import os

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

@app.route("/")
def start_index():
	return render_template("index.html")

#used to get a user iamge from the form. 
@app.route("/upload", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return "No file part", 400

    file = request.files["image"]

    if file.filename == "":
        return "No selected file", 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)

    file.save(filepath)

    data = {"image": filepath}
    result = collection.insert_one(data)

    return f"Image uploaded successfully!\nid: {result.inserted_id}", 200

#start up app.
app.run(host = "0.0.0.0", port=5050)