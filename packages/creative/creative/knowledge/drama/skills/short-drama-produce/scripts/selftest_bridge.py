"""Offline regression tests for the confirmation-gated bundled adapter bridge."""

from __future__ import annotations

import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import production_tool as production
import provider_adapters as adapters


def rejected(category="authentication", submission_rejected=True):
    return production.AdapterError(
        "adapter failed safely",
        public_error={
            "provider": "agnes-image", "category": category, "code": "fixture",
            "retryable": category == "rate_limit", "submission_rejected": submission_rejected,
        },
    )


class CredentialFailoverTests(unittest.TestCase):
    def execute(self, keys, timeout=30):
        return production._run_adapter_with_failover(
            ["unused"], timeout, {"adapter": "agnes-image"}, Path.cwd(),
            credential_name="AGNES_API_KEY", credential_pool=keys,
        )

    def test_rejected_submission_rotates_before_success(self):
        with patch.object(production, "_run_adapter", side_effect=[rejected(), {"outputs": []}]) as run:
            self.assertEqual(self.execute(["dummy-first", "dummy-second"]), {"outputs": []})
        self.assertEqual([call.kwargs["env"]["AGNES_API_KEY"] for call in run.call_args_list], ["dummy-first", "dummy-second"])

    def test_unknown_submission_or_non_key_failure_never_rotates(self):
        for error in [rejected(submission_rejected=False), rejected("timeout"), production.AdapterError("unknown")]:
            with self.subTest(error=error), patch.object(production, "_run_adapter", side_effect=error) as run:
                with self.assertRaises(production.AdapterError):
                    self.execute(["dummy-first", "dummy-second"])
                self.assertEqual(run.call_count, 1)

    def test_exhausted_pool_does_not_reuse_invalid_credentials(self):
        with patch.object(production, "_run_adapter", side_effect=rejected()) as run:
            with self.assertRaises(production.AdapterError):
                self.execute(["dummy-only"])
            self.assertEqual(run.call_count, 1)

    def test_large_pool_stops_after_sixteen_rejections(self):
        with patch.object(production, "_run_adapter", side_effect=rejected()) as run:
            with self.assertRaises(production.AdapterError):
                self.execute([f"dummy-{index}" for index in range(100)])
            self.assertEqual(run.call_count, 16)

    def test_throttle_retries_are_bounded_and_spaced(self):
        with patch.object(production, "_run_adapter", side_effect=rejected("rate_limit")) as run, patch.object(production.time, "sleep") as sleep, patch.object(production.time, "monotonic", return_value=0), patch.object(production.random, "uniform", return_value=1):
            with self.assertRaises(production.AdapterError):
                self.execute(["dummy-only"])
            self.assertEqual(run.call_count, 3)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_backoff_does_not_exceed_the_job_deadline(self):
        with patch.object(production, "_run_adapter", side_effect=rejected("rate_limit")) as run, patch.object(production.time, "sleep") as sleep, patch.object(production.time, "monotonic", return_value=0), patch.object(production.random, "uniform", return_value=1):
            with self.assertRaises(production.AdapterError):
                self.execute(["dummy-first", "dummy-second"], timeout=1)
            self.assertEqual(run.call_count, 1)
            sleep.assert_not_called()

    def test_empty_pool_retains_the_forwarded_environment(self):
        with patch.object(production, "_run_adapter", return_value={"outputs": []}) as run:
            self.assertEqual(self.execute([]), {"outputs": []})
            self.assertEqual(run.call_args.kwargs, {})

    def test_only_explicit_initial_http_rejections_allow_rotation(self):
        for status in (401, 403, 429, 500):
            for submission in (False, True):
                with self.subTest(status=status, submission=submission):
                    error = urllib.error.HTTPError("https://provider.invalid/run", status, "dummy-secret", {}, io.BytesIO(b"{}"))
                    public = adapters._http_failure("agnes-image", error, submission=submission).public("agnes-image")
                    self.assertEqual(public.get("submission_rejected", False), submission and status in {401, 403, 429})
                    self.assertNotIn("dummy-secret", json.dumps(public))

    def test_redirect_rejection_does_not_claim_the_submission_was_rejected(self):
        error = urllib.error.HTTPError("https://provider.invalid/redirect", 401, "rejected", {}, io.BytesIO(b"{}"))
        with patch.object(adapters.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(adapters.AdapterFailure) as raised:
                adapters._request_json("https://provider.invalid/run", provider="agnes-image", token="dummy-key", submission=True)
            self.assertFalse(raised.exception.submission_rejected)

    def test_pool_parser_rejects_malformed_values_without_printing_credentials(self):
        for value in [b"not-json-secret", b'"dummy-secret"', b'["dummy-secret", null]', b'["\\u0000"]', json.dumps(["dummy-secret"] * 17).encode(), b"x" * (production.MAX_ADAPTER_RESPONSE_BYTES + 1)]:
            with self.subTest(size=len(value)), io.TextIOWrapper(io.BytesIO(value)) as stream, patch.object(production.sys, "stdin", stream):
                with self.assertRaises(ValueError) as raised:
                    production._read_credential_pool()
                self.assertNotIn("dummy-secret", str(raised.exception))


class ConfirmedRunTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / "short-drama.json").write_text("{}\n", encoding="utf-8")
        (self.root / "input.txt").write_text("confirmed source", encoding="utf-8")
        self.job_file = self.root / "job.json"
        self.job_file.write_text(json.dumps({
            "job_id": "JOB-001", "adapter": "agnes-image", "modality": "image",
            "prompt": "confirmed prompt", "source": "input.txt", "references": [],
            "outputs": ["production/image.png"], "parameters": {"size": "1K"}, "overwrite": False,
        }), encoding="utf-8")
        self.preview = production.prepare_job(self.root, self.job_file)

    def confirm(self):
        production.confirm_job(self.root, job_id="JOB-001", confirmation=self.preview["confirmation"])

    def execute(self):
        return production.run_job(self.root, job_id="JOB-001", bundled_adapter="agnes-image")

    def test_missing_or_wrong_confirmation_never_reaches_an_adapter(self):
        with patch.object(production, "_run_adapter") as run:
            with self.assertRaises(production.ConfirmationRequiredError):
                self.execute()
            with self.assertRaises(production.ConfirmationRequiredError):
                production.confirm_job(self.root, job_id="JOB-001", confirmation="CONFIRM JOB-001 wrong")
            run.assert_not_called()

    def test_running_job_rejects_reentry_prepare_and_confirmation(self):
        self.confirm()

        def adapter(_command, _timeout, payload, _root):
            with self.assertRaisesRegex(RuntimeError, "already running"):
                self.execute()
            with self.assertRaisesRegex(RuntimeError, "already running"):
                self.confirm()
            with self.assertRaisesRegex(RuntimeError, "already running"):
                production.prepare_job(self.root, self.job_file)
            target = Path(payload["output_root"]) / "image.png"
            target.write_bytes(b"fixture image")
            return {"outputs": [{"target": "production/image.png", "source": str(target)}]}

        with patch.object(production, "_run_adapter", side_effect=adapter) as run:
            result = self.execute()
            self.assertEqual(result["state"], "succeeded")
            self.assertEqual(run.call_count, 1)
        self.assertEqual((self.root / "production/image.png").read_bytes(), b"fixture image")

    def test_unconfirmed_output_targets_fail_without_publication(self):
        self.confirm()

        def adapter(_command, _timeout, payload, _root):
            target = Path(payload["output_root"]) / "image.png"
            target.write_bytes(b"fixture image")
            return {"outputs": [{"target": "production/other.png", "source": str(target)}]}

        with patch.object(production, "_run_adapter", side_effect=adapter):
            with self.assertRaisesRegex(production.AdapterError, "confirmed targets"):
                self.execute()
        self.assertFalse((self.root / "production").exists())
        self.assertEqual(production.job_status(self.root, job_id="JOB-001")["state"], "failed")
        with self.assertRaises(production.ConfirmationRequiredError):
            self.execute()


if __name__ == "__main__":
    unittest.main()
