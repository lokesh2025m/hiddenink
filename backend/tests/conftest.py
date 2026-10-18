import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "")
os.environ.setdefault("MONGODB_URI", "")
# Tests never read or write the real spend counter (backend/eval/results/spend.json).
os.environ["SPEND_FILE"] = str(Path(tempfile.mkdtemp(prefix="hiddenink-test-")) / "spend.json")
