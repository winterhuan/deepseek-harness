"""Offline regressions for storyctl's subprocess result classification."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

script = Path(sys.argv.pop(1))
spec = importlib.util.spec_from_file_location("storyctl", script)
storyctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storyctl)

SOURCES = {
    "check-ai-patterns.js": "ai-pattern",
    "check-degeneration.js": "degeneration",
    "normalize-punctuation.js": "punctuation",
    "check-outline-copy.js": "outline-copy",
}


class QualityResults(unittest.TestCase):
    def check_result(self, script_name, *, status=0, stdout="", stderr="", error=None):
        def execute(args, **kwargs):
            name = Path(args[1]).name
            if name == script_name:
                if error is not None:
                    raise error
                return subprocess.CompletedProcess(args, status, stdout, stderr)
            output = json.dumps({"findings": []}) if "--json" in args else ""
            return subprocess.CompletedProcess(args, 0, output, "")

        with patch.object(storyctl.shutil, "which", return_value="node"), patch.object(
            storyctl.subprocess, "run", side_effect=execute,
        ):
            return storyctl.check_blocking_quality(Path("outline.md"), Path("body.md"))

    def test_no_findings_pass(self):
        self.assertEqual(self.check_result(None), {
            "status": "pass", "blocking_findings": [], "advisories": [],
        })

    def test_blocking_findings_are_not_tool_errors(self):
        finding = {"type": "not-is-comparison", "severity": "blocking"}
        result = self.check_result("check-ai-patterns.js", status=1, stdout=json.dumps({"findings": [finding]}))
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["blocking_findings"], [{"source": "ai-pattern", **finding}])

    def test_advisories_do_not_block(self):
        finding = {"type": "long-paragraph", "severity": "advisory"}
        result = self.check_result("check-ai-patterns.js", stdout=json.dumps({"findings": [finding]}))
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["advisories"], [{"source": "ai-pattern", **finding}])

    def test_invalid_json_is_a_tool_error(self):
        for output in ("", "not-json", "{}", "[]", '{"findings":{}}', '{"findings":[null]}', '{"findings":[{"severity":[]}]}'):
            with self.subTest(output=output):
                result = self.check_result("check-ai-patterns.js", stdout=output)
                self.assertEqual(result["status"], "fail")
                self.assertEqual(result["blocking_findings"][0]["type"], "TOOL_ERROR")

    def test_exit_status_must_match_blocking_findings(self):
        for status, findings in ((1, []), (0, [{"severity": "blocking"}])):
            with self.subTest(status=status):
                result = self.check_result("check-ai-patterns.js", status=status, stdout=json.dumps({"findings": findings}))
                self.assertEqual(result["status"], "fail")
                self.assertEqual(result["blocking_findings"][0]["type"], "TOOL_ERROR")

    def test_runtime_failure_is_not_a_finding(self):
        for name, source in SOURCES.items():
            for status in (1, 2, -9):
                with self.subTest(script=name, status=status):
                    result = self.check_result(name, status=status, stderr="ReferenceError: script failed")
                    self.assertEqual(result["status"], "fail")
                    self.assertEqual(result["advisories"], [])
                    self.assertEqual(result["blocking_findings"][0]["type"], "TOOL_ERROR")
                    self.assertEqual(result["blocking_findings"][0]["source"], source)

    def test_launch_failures_are_tool_errors(self):
        for name in SOURCES:
            with self.subTest(script=name):
                result = self.check_result(name, error=OSError("unable to spawn node"))
                self.assertEqual(result["status"], "fail")
                self.assertEqual(result["blocking_findings"][0]["type"], "TOOL_ERROR")

    def test_text_findings_keep_their_severity(self):
        punctuation = self.check_result("normalize-punctuation.js", status=1, stdout="body.md:1:1: em-dash\n")
        self.assertEqual(punctuation["status"], "fail")
        self.assertEqual(punctuation["blocking_findings"][0]["type"], "PUNCTUATION_NOT_NORMALIZED")
        overlap = self.check_result("check-outline-copy.js", status=1, stdout="overlapping prose\n")
        self.assertEqual(overlap["status"], "pass")
        self.assertEqual(overlap["advisories"][0]["type"], "OUTLINE_COPY_REVIEW")

    def test_missing_node_is_unavailable(self):
        with patch.object(storyctl.shutil, "which", return_value=None):
            result = storyctl.check_blocking_quality(Path("outline.md"), Path("body.md"))
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["blocking_findings"][0]["type"], "TOOL_UNAVAILABLE")

    def test_missing_scripts_are_unavailable(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            storyctl, "__file__", str(Path(directory) / "storyctl.py"),
        ):
            result = self.check_result(None)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(len(result["blocking_findings"]), len(SOURCES))
        self.assertTrue(all(finding["type"] == "TOOL_UNAVAILABLE" for finding in result["blocking_findings"]))


if __name__ == "__main__":
    unittest.main()
