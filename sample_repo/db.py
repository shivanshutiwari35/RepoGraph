class MockClient:
    def __init__(self, name):
        self.name = name
    def __getattr__(self, name):
        return MockClient(name)
    def set(self, key, val):
        pass
    def get(self, key):
        return None
    def insert_one(self, data):
        pass
    def find_one(self, query):
        return None

# Database connection clients
mongodb = MockClient("mongodb")
redis = MockClient("redis")
