import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

LOG_FILE = Path(__file__).resolve().parent.parent / "cursor-events.jsonl"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MOJIBAKE_ROOT = PROJECT_ROOT.as_posix()
BROKEN_ROOT = "繧ｿ繧ｹ繧ｯ邂｡逅・"

FIELD_PATTERNS = {
    "hook_event_name": re.compile(r'"hook_event_name"\s*:\s*"([^"]+)"'),
    "session_id": re.compile(r'"session_id"\s*:\s*"([^"]+)"'),
    "conversation_id": re.compile(r'"conversation_id"\s*:\s*"([^"]+)"'),
    "generation_id": re.compile(r'"generation_id"\s*:\s*"([^"]+)"'),
    "tool_name": re.compile(r'"tool_name"\s*:\s*"([^"]+)"'),
    "model": re.compile(r'"model"\s*:\s*"([^"]+)"'),
    "model_id": re.compile(r'"model_id"\s*:\s*"([^"]+)"'),
    "composer_mode": re.compile(r'"composer_mode"\s*:\s*"([^"]+)"'),
    "subagent_type": re.compile(r'"subagent_type"\s*:\s*"([^"]+)"'),
    "is_background_agent": re.compile(r'"is_background_agent"\s*:\s*(true|false)'),
    "duration": re.compile(r'"duration"\s*:\s*([0-9.]+)'),
    "input_tokens": re.compile(r'"input_tokens"\s*:\s*([0-9]+)'),
    "output_tokens": re.compile(r'"output_tokens"\s*:\s*([0-9]+)'),
}


def sanitize(value):
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    if isinstance(value, dict):
        return {sanitize(k): sanitize(v) for k, v in value.items()}
    return value


def fix_mojibake(text):
    if not text or not isinstance(text, str):
        return text

    candidates = [text]
    for encoding in ("cp932", "latin-1"):
        try:
            candidates.append(text.encode(encoding).decode("utf-8"))
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue

    for candidate in candidates:
        if "タスク管理" in candidate:
            return candidate

    return text


def repair_json_text(text):
    project_name = PROJECT_ROOT.name
    repaired = fix_mojibake(text.strip().lstrip("\ufeff"))
    repaired = repaired.replace(BROKEN_ROOT + "]", f'{project_name}"]')
    repaired = repaired.replace(BROKEN_ROOT + '"', f'{project_name}"')
    repaired = repaired.replace(BROKEN_ROOT, project_name)
    repaired = repaired.replace(MOJIBAKE_ROOT, PROJECT_ROOT.as_posix())
    return repaired


def try_parse_json(text):
    for candidate in {text, repair_json_text(text)}:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def decode_stdin(raw_bytes):
    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        raw_bytes = raw_bytes[3:]

    texts = []
    for encoding in ("utf-8", "utf-8-sig", "cp932"):
        try:
            texts.append(raw_bytes.decode(encoding))
        except UnicodeDecodeError:
            continue
    texts.append(raw_bytes.decode("utf-8", errors="replace"))
    return texts


def extract_fields(text):
    repaired = repair_json_text(text)
    extracted = {}

    for key, pattern in FIELD_PATTERNS.items():
        match = pattern.search(repaired)
        if not match:
            continue
        value = match.group(1)
        if key in {"duration"}:
            extracted[key] = float(value)
        elif key in {"input_tokens", "output_tokens"}:
            extracted[key] = int(value)
        elif key == "is_background_agent":
            extracted[key] = value == "true"
        else:
            extracted[key] = value

    file_match = re.search(
        r'"file_path"\s*:\s*"(?:[^"\\]|\\.)*README\.md"',
        repaired,
    )
    if file_match:
        extracted["file_path"] = str(PROJECT_ROOT / "README.md")

    command_match = re.search(r'"command"\s*:\s*"((?:[^"\\]|\\.)*)"', repaired)
    if command_match:
        extracted["command"] = (
            command_match.group(1)
            .encode("utf-8", "replace")
            .decode("unicode_escape")
            .replace(BROKEN_ROOT, PROJECT_ROOT.name)
        )

    return extracted


def load_event(raw_bytes):
    texts = decode_stdin(raw_bytes)

    for text in texts:
        parsed = try_parse_json(text)
        if parsed is not None:
            return parsed

    fallback_text = texts[0]
    extracted = extract_fields(fallback_text)
    if extracted:
        extracted["parse_mode"] = "regex"
        return extracted

    return {"raw": fallback_text, "parse_error": True}


def summarize(event):
    if not isinstance(event, dict) or event.get("parse_error"):
        return None

    summary = {
        "event_type": event.get("hook_event_name"),
        "session_id": event.get("session_id"),
        "tool": event.get("tool_name"),
        "model": event.get("model"),
        "model_id": event.get("model_id"),
        "composer_mode": event.get("composer_mode"),
        "subagent_type": event.get("subagent_type"),
    }

    if event.get("is_background_agent") is not None:
        value = event.get("is_background_agent")
        summary["is_background_agent"] = value if isinstance(value, bool) else value == "true"

    if event.get("duration") is not None:
        summary["duration_ms"] = event.get("duration")

    if event.get("file_path"):
        summary["file_path"] = event.get("file_path")

    if event.get("command"):
        summary["command"] = event.get("command")

    if event.get("hook_event_name") == "afterAgentResponse":
        summary["output_tokens"] = event.get("output_tokens")
        summary["input_tokens"] = event.get("input_tokens")

    return {k: v for k, v in summary.items() if v is not None}


def load_dotenv():
    env = {}
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return env

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")

    return env


def forward_event(record):
    env = load_dotenv()
    api_url = env.get("CURSOR_EVENTS_API_URL")
    if not api_url:
        return

    payload = dict(record)
    project = env.get("CURSOR_EVENTS_PROJECT")
    if project:
        payload["project"] = project

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        sys.stderr.write(f"audit.py forward failed: {exc}\n")


def main():
    event = sanitize(load_event(sys.stdin.buffer.read()))
    record = {
        "recorded_at": datetime.now().isoformat(),
        "event": event,
    }

    summary = summarize(event)
    if summary:
        record["summary"] = summary

    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8", errors="replace") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    if summary:
        forward_event(record)

    print("{}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write(f"audit.py failed: {exc}\n")
        print("{}")
