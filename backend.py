import os
from flask import Flask
from utils.config import Config
from routes.auth import auth_bp
from routes.gallery import gallery_bp
from routes.uploads import uploads_bp
from routes.my_uploads import my_uploads_bp


def create_app() -> Flask:
    app = Flask(__name__)

    # Load config
    app.config["SECRET_KEY"]    = Config.SECRET_KEY
    app.config["UPLOAD_FOLDER"] = Config.UPLOAD_FOLDER

    # Ensure the uploads folder exists
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(gallery_bp)
    app.register_blueprint(uploads_bp)
    app.register_blueprint(my_uploads_bp)

    return app


app = create_app()


if __name__ == "__main__":
    if Config.FLASK_ENV == "production":
        app.run(host="0.0.0.0", port=5050)
    elif Config.SSL_CERT and Config.SSL_KEY:
        app.run(host="0.0.0.0", port=5050,
                ssl_context=(Config.SSL_CERT, Config.SSL_KEY))
    else:
        app.run(host="0.0.0.0", port=5050)