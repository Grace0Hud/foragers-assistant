from flask import Flask, render_template, request
from pymongo import MongoClient
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import os

#loading enviornment variables.
load_dotenv()
MONGODB_URI = os.getenv("DATABASE_URL")
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
        return "No file part"

    file = request.files["image"]

    if file.filename == "":
        return "No selected file"

    # Sanitize filename, makes sure we get the correct file type. 
    filename = secure_filename(file.filename)

    # Save file into local upload folder. In server, they will be saved on the server. 
    file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))

    return "Image uploaded successfully!"

#start up app.
app.run(host = "0.0.0.0", port=5050)