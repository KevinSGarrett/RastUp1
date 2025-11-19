.PHONY: ci test-python test-node

ci: test-python test-node
	@echo "CI suite completed."

test-python:
	python -m unittest tests.python.test_booking_schema

test-node:
	node --test tests/booking/*.test.mjs
