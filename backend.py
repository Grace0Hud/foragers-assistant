from flask import Flask, render_template
from pymongo import MongoClient
from dotenv import load_dotenv
import os

load_dotenv()
MONGODB_URI = os.getenv("DATABASE_URL")
client = MongoClient(MONGODB_URI)

db = client["5-dollar"]
collection = db["food"]

app = Flask(__name__)

@app.route("/")
def start_index():
    return render_template("index.html")

@app.route("/welcome")
def welcome():
    return "<html><body><h1><em>Welcome to CS4800! Enjoy the full-stack dev!</em></h1></body></html>"

@app.route("/search/<budget>") # mapping
def search_food_items(budget):
    budget = float(budget)
    result = []
    for food in collection.find():
        if food['price'] <= budget:
            food["_id"] = str(food["_id"])
            result.append(food)
    print(result)
    return result

app.run(host = "0.0.0.0", port=5050)