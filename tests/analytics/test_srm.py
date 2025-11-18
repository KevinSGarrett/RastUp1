from tools.analytics.srm import chi_square_srm


import unittest


class TestSrm(unittest.TestCase):
    def test_srm_detects_no_mismatch(self):
        result = chi_square_srm([5050, 4950], [0.5, 0.5])
        self.assertAlmostEqual(result["chi2"], 1.0, delta=0.1)
        self.assertGreater(result["p_value"], 0.3)

    def test_srm_detects_mismatch(self):
        result = chi_square_srm([6000, 4000], [0.5, 0.5])
        self.assertGreater(result["chi2"], 80)
        self.assertLess(result["p_value"], 1e-5)

    def test_srm_validation(self):
        with self.assertRaises(ValueError):
            chi_square_srm([], [])
        with self.assertRaises(ValueError):
            chi_square_srm([10, 20], [0.5])


if __name__ == "__main__":
    unittest.main()
