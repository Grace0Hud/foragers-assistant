import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY   = os.getenv("SECRET_KEY")
    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "uploads")
    MONGODB_URI  = os.getenv("MONGODB_URI")
    SSL_CERT     = os.getenv("SSL_CERT")
    SSL_KEY      = os.getenv("SSL_KEY")
    FLASK_ENV    = os.getenv("FLASK_ENV", "development")
    PHOTO_COLLECTION = "test-photos" if FLASK_ENV == "dev" else "user-photos"
