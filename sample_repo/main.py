from fastapi import FastAPI, Depends
from users import UserService
import db

app = FastAPI()
user_service = UserService()

@app.get("/")
def read_root():
    return {"message": "Welcome to Sample Service"}

@app.post("/users")
def create_user(name: str):
    # Triggers database save
    user = user_service.create_user(name)
    db.redis_client.set(f"user:{user['id']}", "active")
    return user

@app.get("/users/{user_id}")
def get_user(user_id: int):
    # Reads from cache
    cached = db.redis_client.get(f"user:{user_id}")
    if cached:
        return {"id": user_id, "cached": True}
    return user_service.get_user(user_id)
