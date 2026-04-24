import os
from flask import Flask, session
from utils.config import Config
from routes.auth import auth_bp
from routes.gallery import gallery_bp
from routes.uploads import uploads_bp
from routes.my_uploads import my_uploads_bp
from utils.analytics import hash_analytics_user_id
from utils.db import user_collection


def create_app() -> Flask:
    app = Flask(__name__)

    # Load config
    app.config["SECRET_KEY"]    = Config.SECRET_KEY
    app.config["UPLOAD_FOLDER"] = Config.UPLOAD_FOLDER

    # Ensure the uploads folder exists
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    # Inject Google Analytics ID into templates (production only)
    @app.context_processor
    def inject_globals():
        in_production = Config.FLASK_ENV == "production"
        ga_user_id = None

        if "username" in session:
            ga_user_id = session.get("ga_user_id")
            if not ga_user_id:
                user = user_collection.find_one({"username": session["username"]}, {"_id": 1})
                if user is not None:
                    ga_user_id = hash_analytics_user_id(user["_id"])
                    session["ga_user_id"] = ga_user_id
                    session.modified = True

        return {
            "ga_measurement_id": Config.GA_MEASUREMENT_ID if in_production else "",
            "ga_logged_in": "username" in session,
            "ga_user_id": ga_user_id,
        }

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
