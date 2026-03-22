from functools import wraps
from flask import session, redirect, url_for


def login_required(f):
    """Redirect unauthenticated users to the sign-in page."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("auth.signin_page"))
        return f(*args, **kwargs)
    return decorated
