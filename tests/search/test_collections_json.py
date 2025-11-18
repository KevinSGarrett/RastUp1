import json
import pathlib
import unittest


COLLECTIONS_PATH = pathlib.Path(__file__).resolve().parents[2] / "ops" / "typesense" / "collections.json"


def load_collections():
    with COLLECTIONS_PATH.open("r", encoding="utf-8") as fp:
        return json.load(fp)


class CollectionsSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.collections = load_collections()

    def test_collections_schema_contains_people_and_studios(self):
        names = {collection["name"] for collection in self.collections["collections"]}
        for expected in ("people_v1", "studios_v1", "work_v1", "help_v1"):
            self.assertIn(expected, names, f"{expected} missing from collections")

    def test_people_collection_has_safe_mode_field(self):
        people = next(collection for collection in self.collections["collections"] if collection["name"] == "people_v1")
        field_names = {field["name"] for field in people["fields"]}
        self.assertIn("safeModeBandMax", field_names)
        self.assertIn("promotionSlot", field_names)

    def test_synonyms_include_required_entries(self):
        synonym_ids = {syn["id"] for syn in self.collections["synonyms"]}
        self.assertIn("glam_syn", synonym_ids)
        self.assertIn("bnw_syn", synonym_ids)


if __name__ == "__main__":
    unittest.main()
