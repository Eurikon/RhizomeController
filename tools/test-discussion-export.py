import importlib.util
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "export_discussions", Path(__file__).resolve().parents[1] / "scripts/export-discussions.py"
)
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class DiscussionExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_archive_survives_leaving_recent_five(self):
        EXPORT.write_threads(self.root, [{"number": 1, "title": "Earlier topic"}])
        EXPORT.write_threads(self.root, [{"number": n} for n in range(2, 7)])
        self.assertEqual(json.loads((self.root / "1.json").read_text())["discussions"][0]["title"], "Earlier topic")

    def test_unchanged_archive_is_not_rewritten(self):
        item = {"number": 1, "title": "Existing topic"}
        self.assertTrue(EXPORT.write_threads(self.root, [item]))
        before = (self.root / "1.json").read_bytes()
        self.assertFalse(EXPORT.write_threads(self.root, [item]))
        self.assertEqual((self.root / "1.json").read_bytes(), before)
        self.assertFalse(list(self.root.glob("*.tmp")))

    def test_changed_post_replaces_archived_body(self):
        EXPORT.write_threads(self.root, [{"number": 1, "bodyHTML": "Before"}])
        self.assertTrue(EXPORT.write_threads(self.root, [{"number": 1, "bodyHTML": "After"}]))
        self.assertEqual(json.loads((self.root / "1.json").read_text())["discussions"][0]["bodyHTML"], "After")

    def test_deletion_removes_only_matching_archive(self):
        items = [{"number": 1}, {"number": 2}]
        EXPORT.write_threads(self.root, items)
        self.assertTrue(EXPORT.write_threads(self.root, items, deleted=1))
        self.assertFalse((self.root / "1.json").exists())
        self.assertTrue((self.root / "2.json").is_file())

    def test_only_valid_discussion_deletion_event_removes_archive(self):
        event = self.root / "event.json"
        for event_name, action, number, expected in [
            ("discussion", "deleted", 3, 3),
            ("discussion_comment", "deleted", 3, None),
            ("discussion", "edited", 3, None),
            ("discussion", "deleted", "../3", None),
            ("discussion", "deleted", True, None),
        ]:
            with self.subTest(event_name=event_name, action=action, number=number):
                event.write_text(json.dumps({"action": action, "discussion": {"number": number}}))
                with patch.dict(os.environ, {"GITHUB_EVENT_NAME": event_name, "GITHUB_EVENT_PATH": str(event)}):
                    self.assertEqual(EXPORT.deleted_discussion(), expected)


if __name__ == "__main__":
    unittest.main()
