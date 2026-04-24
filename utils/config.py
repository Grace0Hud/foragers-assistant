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
    GA_MEASUREMENT_ID = os.getenv("GA_MEASUREMENT_ID", "")
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
    SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    BUG_REPORT_TO_EMAIL = os.getenv("BUG_REPORT_TO_EMAIL", "")
    BUG_REPORT_FROM_EMAIL = os.getenv("BUG_REPORT_FROM_EMAIL", SMTP_USERNAME)
