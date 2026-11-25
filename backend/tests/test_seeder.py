"""Test Database Seeder Service."""

import asyncio
import os
from pathlib import Path
import sys
import unittest

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-seeder-testing"

from app.database.seed import seed_data
from app.models.tenant import Tenant


class MockScalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class MockResult:
    def __init__(self, items):
        self._items = items

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class MockAsyncSession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement):
        return MockResult([])  # Simulate fresh database without existing tenant

    async def commit(self):
        pass


class TestDatabaseSeeder(unittest.TestCase):
    def test_seed_fresh_database(self):
        db = MockAsyncSession()
        res = asyncio.run(seed_data(db, force=True))
        self.assertTrue(res["seeded"])
        self.assertEqual(res["hospital_name"], "Apollo Metro Hospital")
        self.assertEqual(res["doctors_count"], 5)
        self.assertEqual(res["patients_count"], 5)
        self.assertGreaterEqual(len(db.added), 15)


if __name__ == "__main__":
    unittest.main()
