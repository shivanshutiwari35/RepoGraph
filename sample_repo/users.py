import db

class UserService:
    def __init__(self):
        pass

    def create_user(self, name: str) -> dict:
        user = {"id": 1, "name": name}
        # Writes to database
        db.mongodb.users.insert_one(user)
        return user

    def get_user(self, user_id: int) -> dict:
        # Reads from database
        user = db.mongodb.users.find_one({"id": user_id})
        return user or {}
