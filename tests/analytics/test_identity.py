import unittest

from tools.analytics.identity import stitch_identities


class TestIdentity(unittest.TestCase):
    def test_stitch_identities_clusters_members_and_confidence(self):
        events = [
            {"user_id": "usr_1", "anon_id": "anon_a", "session_id": "ses_1"},
            {"anon_id": "anon_a", "session_id": "ses_2"},
            {"user_id": "usr_2", "device_id": "dev_1"},
            {"anon_id": "anon_b", "session_id": "ses_3", "device_id": "dev_1"},
        ]

        identities = stitch_identities(events, salt="secret_salt")

        self.assertEqual(len(identities), 2)
        sizes = sorted(identity["size"] for identity in identities)
        self.assertEqual(sizes, [4, 4])

        with_user = [identity for identity in identities if identity["members"].get("user_id")]
        self.assertEqual(len(with_user), 2)

        first = with_user[0]
        self.assertEqual(len(first["members"].get("user_id", [])), 1)
        self.assertGreaterEqual(len(first["members"].get("session_id", [])), 1)
        self.assertGreater(first["confidence"], 0.0)
        self.assertLessEqual(first["confidence"], 1.0)

        device_identities = [identity for identity in identities if identity["members"].get("device_id")]
        self.assertEqual(len(device_identities), 1)
        device_identity = device_identities[0]
        self.assertEqual(len(device_identity["members"].get("device_id", [])), 1)
        self.assertLess(device_identity["confidence"], 1.0)


if __name__ == "__main__":
    unittest.main()
