from tools.analytics.cuped import apply_cuped_adjustment, compute_theta


import unittest


class TestCuped(unittest.TestCase):
    def test_compute_theta_identity_relationship(self):
        pre = [1, 2, 3, 4]
        outcome = [2, 3, 4, 5]  # perfect linear shift

        theta = compute_theta(pre, outcome)
        self.assertAlmostEqual(theta, 1.0, places=6)

        adjusted = apply_cuped_adjustment(outcome, pre, theta=theta)
        for value in adjusted:
            self.assertAlmostEqual(value, 3.5, places=6)

    def test_compute_theta_handles_low_variance(self):
        pre = [5, 5, 5, 5]
        outcome = [5, 6, 4, 7]
        theta = compute_theta(pre, outcome)
        self.assertEqual(theta, 0.0)

        adjusted = apply_cuped_adjustment(outcome, pre, theta=theta)
        self.assertEqual(adjusted, list(outcome))

    def test_apply_cuped_requires_equal_length(self):
        with self.assertRaises(ValueError):
            apply_cuped_adjustment([1, 2, 3], [1, 2])


if __name__ == "__main__":
    unittest.main()
