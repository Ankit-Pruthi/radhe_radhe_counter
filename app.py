
from flask import Flask, jsonify, render_template, request, session
import os

app = Flask(__name__)

secret_key = os.environ.get("FLASK_SECRET_KEY")

if not secret_key:
    raise RuntimeError(
        "FLASK_SECRET_KEY environment variable is not configured."
    )

app.secret_key = secret_key


def ensure_state():
    session.setdefault("jaaps_per_loop", 108)
    session.setdefault("total_loops", 5)
    session.setdefault("completed_loops", 0)
    session.setdefault("current_count", 0)


def state_response():
    ensure_state()
    per_loop = session["jaaps_per_loop"]
    loops = session["total_loops"]
    completed = session["completed_loops"]
    current = session["current_count"]

    return jsonify(
        jaaps_per_loop=per_loop,
        total_loops=loops,
        completed_loops=completed,
        current_count=current,
        current_loop=min(completed + 1, loops),
        total_count=completed * per_loop + current,
        total_target=per_loop * loops,
        all_completed=(completed == loops),
    )


@app.get("/")
def index():
    ensure_state()
    return render_template("index.html")


@app.get("/api/state")
def get_state():
    return state_response()


@app.post("/api/count")
def update_count():
    ensure_state()
    data = request.get_json(silent=True) or {}
    action = data.get("action")

    per_loop = session["jaaps_per_loop"]
    loops = session["total_loops"]
    completed = session["completed_loops"]
    current = session["current_count"]

    if action == "increment":
        if completed < loops:
            current += 1
            if current >= per_loop:
                current = 0
                completed += 1

            session["current_count"] = current
            session["completed_loops"] = completed

    elif action == "decrement":
        if current > 0:
            session["current_count"] = current - 1

    elif action == "reset":
        # Reset the current loop only.
        # If the whole session was complete, reopen its last loop.
        if completed == loops and loops > 0:
            session["completed_loops"] = loops - 1
        session["current_count"] = 0

    elif action == "reset_everything":
        session["completed_loops"] = 0
        session["current_count"] = 0

    elif action == "set_settings":
        try:
            new_per_loop = int(data.get("jaaps_per_loop"))
            new_loops = int(data.get("total_loops"))
            if (
                new_per_loop < 1 or new_loops < 1
                or new_per_loop > 1000000 or new_loops > 100000
            ):
                raise ValueError
        except (TypeError, ValueError):
            return jsonify(
                error="Enter positive whole numbers for both settings."
            ), 400

        if session["completed_loops"] or session["current_count"]:
            return jsonify(
                error="Reset everything before changing loop settings."
            ), 400

        session["jaaps_per_loop"] = new_per_loop
        session["total_loops"] = new_loops

    else:
        return jsonify(error="Unknown action."), 400

    session.modified = True
    return state_response()


if __name__ == "__main__":
    app.run(debug=True)
