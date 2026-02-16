import json
import os
import subprocess
import sys
import tempfile

from ..core.processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor


class PythonCodeProcessor(BasicProcessor):
    """Minimal python sandbox v1.

    This is NOT a strong security sandbox. It is a controlled subprocess runner with:
    - isolated python mode (-I -S)
    - a hard timeout

    Inputs:
      - payload (string/json)
    Config:
      - code (python source)
      - timeout_sec (default 3)

    Contract:
      The subprocess receives JSON on stdin as {"payload": <payload>}.
      User code should write JSON to stdout to be consumed by downstream nodes.
      If stdout is not JSON, we pass raw stdout text.
    """

    processor_type = ProcessorType.PYTHON_CODE

    def __init__(self, config):
        super().__init__(config)
        self.payload = config.get("payload")
        self.code = config.get("code") or ""
        self.timeout_sec = float(config.get("timeout_sec", 3))

    def process(self):
        payload_value = self.get_input_by_name("payload", self.payload)
        try:
            # ensure json-serializable
            json.dumps(payload_value)
        except Exception:
            payload_value = str(payload_value)

        wrapper = (
            "import json,sys\n"
            "data=json.load(sys.stdin)\n"
            "payload=data.get('payload')\n"
            "globals_dict={'payload': payload}\n"
            "locals_dict={}\n"
            "code=data.get('code','')\n"
            "exec(compile(code,'<user_code>','exec'), globals_dict, locals_dict)\n"
            "result=locals_dict.get('result', globals_dict.get('result', None))\n"
            "if result is not None:\n"
            "  sys.stdout.write(json.dumps(result))\n"
        )

        with tempfile.TemporaryDirectory(prefix="aski_pycode_") as tmp:
            inp = json.dumps({"payload": payload_value, "code": self.code})
            cmd = [sys.executable, "-I", "-S", "-c", wrapper]
            env = {
                "PYTHONUNBUFFERED": "1",
                "PYTHONDONTWRITEBYTECODE": "1",
                # Make it explicit we're local-only.
                "ASKI_FLOW": "1",
                **{k: v for k, v in os.environ.items() if k.startswith("ASKI_")},
            }
            try:
                proc = subprocess.run(
                    cmd,
                    input=inp.encode("utf-8"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=tmp,
                    timeout=max(self.timeout_sec, 0.5),
                    env=env,
                )
            except subprocess.TimeoutExpired:
                return ["{\"error\":\"python-code timeout\"}"]

        stdout = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
        stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            return [json.dumps({"error": "python-code failed", "stderr": stderr})]

        if not stdout:
            # Allow empty result; still surface stderr as debug.
            return [json.dumps({"result": None, "stderr": stderr}) if stderr else ""]

        # If output is valid JSON, pass it as-is; otherwise pass raw text.
        try:
            json.loads(stdout)
            return [stdout]
        except Exception:
            if stderr:
                return [stdout + "\n" + stderr]
            return [stdout]
