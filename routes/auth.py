from flask import Blueprint, render_template, request, session, redirect, url_for
from pymongo.errors import DuplicateKeyError
from werkzeug.security import check_password_hash, generate_password_hash
from utils.analytics import hash_analytics_user_id
from utils.db import user_collection
from utils.sanitize import sanitize_username, sanitize_password

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["GET"])
def signin_page():
    if "username" in session:
        return redirect(url_for("gallery.get_gallery"))
    return render_template("signin.html")


@auth_bp.route("/login", methods=["POST"])
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
    session["ga_user_id"] = hash_analytics_user_id(user["_id"])
    session.modified = True
    return redirect(url_for("gallery.get_gallery"))


@auth_bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("gallery.help_page"))


@auth_bp.route("/signup", methods=["GET"])
def signup_page():
    if "username" in session:
        return redirect(url_for("gallery.get_gallery"))
    return render_template("signup.html")


@auth_bp.route("/signup", methods=["POST"])
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

    if password != request.form.get("confirm_password", ""):
        return render_template("signup.html", error="Passwords do not match.",
                               previous_username=username)

    if user_collection.find_one({"username": username}):
        return render_template("signup.html", error="That username is already taken.",
                               previous_username=username)

    try:
        result = user_collection.insert_one(
            {"username": username, "password": generate_password_hash(password)}
        )
    except DuplicateKeyError:
        return render_template("signup.html", error="That username is already taken.",
                               previous_username=username)

    session["username"] = username
    session["ga_user_id"] = hash_analytics_user_id(result.inserted_id)
    session.modified = True
    return redirect(url_for("gallery.get_gallery"))
