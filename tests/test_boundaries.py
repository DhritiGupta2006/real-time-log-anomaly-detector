"""Architectural boundary tests (IMPLEMENTATION_PLAN-2-2.md §3.1 and §13).

Enforces that the detection core remains pure:
  - No network, AWS, socket, or framework imports in services/detection/
"""

import ast
from pathlib import Path

FORBIDDEN_IMPORTS = {
    "boto3",
    "botocore",
    "fastapi",
    "starlette",
    "uvicorn",
    "requests",
    "httpx",
    "socket",
    "redis",
}


def test_detection_core_imports_no_io_or_network_libraries():
    detection_dir = Path(__file__).parent.parent / "services" / "detection"
    assert detection_dir.is_dir()

    violations = []
    # Inspect pure core files (baseline, detector, severity, window)
    core_files = ["baseline.py", "detector.py", "severity.py", "window.py"]
    for filename in core_files:
        filepath = detection_dir / filename
        if not filepath.exists():
            continue

        tree = ast.parse(filepath.read_text(encoding="utf-8"), filename=str(filepath))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root_pkg = alias.name.split(".")[0]
                    if root_pkg in FORBIDDEN_IMPORTS:
                        violations.append((filename, alias.name, node.lineno))
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    root_pkg = node.module.split(".")[0]
                    if root_pkg in FORBIDDEN_IMPORTS:
                        violations.append((filename, node.module, node.lineno))

    assert not violations, f"Architectural boundary violation in detection core: {violations}"
