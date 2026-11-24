#!/usr/bin/env python3
"""Host tests for @octen.ai/pi-extension.

Drives a real Pi install with the packed extension and checks what Pi tells the model about the
Octen MCP server and what a tool call returns.

    OCTEN_API_KEY=<key> MODEL_BASE_URL=<OpenAI-compatible URL> MODEL_ID=<model> MODEL_API_KEY=<key> \
        python3 test/host/run.py --pi <path to pi> --state <empty dir> \
        [--login-state <mcp-auth.json from a sign-in inside Pi>]

These checks do not run in CI: they need the network and the hosted Octen MCP server. Rows that
only look at what Pi offers the model use a local stand-in for the model. Rows that make a tool
call need a real model, given by the three MODEL_ variables, and a real key (billed searches).
The sign-in rows need a credential file that only a person can produce. Use a sign-in made for
these tests, not the one you work with: when a run refreshes the tokens, the server rotates the
refresh token, and the file you passed is spent; sign in again before the next run. A row whose
precondition is missing prints SKIP, which is not a pass.

All Pi state goes under --state, and Pi is started with --no-context-files so that no
AGENTS.md or CLAUDE.md from a parent directory is sent to the model.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tarfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MCP_URL = "https://mcp.octen.ai/mcp"
PACKAGE = "@octen.ai/pi-extension"
WRONG_KEY = "your-api-key"
PROMPT = "What is the current Node.js LTS version? Search the web and cite one URL."
PACKAGE_DIR = Path(__file__).resolve().parents[2]


class Stub(ThreadingHTTPServer):
    """An OpenAI-compatible endpoint that records the tool names of each request and answers "ok"."""

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), StubHandler)
        self.seen: list[list[str]] = []


class StubHandler(BaseHTTPRequestHandler):
    server: Stub

    def log_message(self, *args: object) -> None:  # keep the test output clean
        pass

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        names = [tool.get("function", {}).get("name") for tool in body.get("tools") or []]
        self.server.seen.append([name for name in names if name])

        def chunk(delta: dict, finish: str | None = None) -> bytes:
            data = {
                "id": "stub",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": body.get("model"),
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            if finish:
                data["usage"] = {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
            return ("data: " + json.dumps(data) + "\n\n").encode()

        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        self.wfile.write(chunk({"role": "assistant", "content": "ok"}))
        self.wfile.write(chunk({}, "stop"))
        self.wfile.write(b"data: [DONE]\n\n")


class Host:
    def __init__(self, pi: str, state: Path, stub: Stub, model: dict | None) -> None:
        # A path is resolved now, because every run starts in a directory under --state.
        self.pi = str(Path(pi).resolve()) if os.sep in pi else pi
        self.state = state
        self.stub = stub
        self.model = model
        self.logs = state / "logs"
        self.logs.mkdir(parents=True)
        (state / "work").mkdir()
        (state / "tmp").mkdir()

    def home(self, name: str = "home") -> Path:
        home = self.state / name
        agent = home / ".pi" / "agent"
        if not agent.exists():
            agent.mkdir(parents=True)
            providers = {
                "stub": {
                    "baseUrl": f"http://127.0.0.1:{self.stub.server_address[1]}/v1",
                    "api": "openai-completions",
                    "apiKey": "stub",
                    "models": [{"id": "model", "contextWindow": 200000, "maxTokens": 16384}],
                }
            }
            if self.model:
                providers["real"] = {
                    "baseUrl": self.model["base_url"],
                    "api": "openai-completions",
                    "apiKey": "${MODEL_API_KEY}",
                    "models": [{"id": self.model["id"], "contextWindow": 200000, "maxTokens": 16384}],
                }
            (agent / "models.json").write_text(json.dumps({"providers": providers}, indent=2))
        return home

    def env(self, home: Path, key: str | None) -> dict[str, str]:
        env = {name: value for name, value in os.environ.items() if name != "OCTEN_API_KEY"}
        env.update(
            HOME=str(home),
            PI_CODING_AGENT_DIR=str(home / ".pi" / "agent"),
            XDG_CONFIG_HOME=str(home / ".config"),
            XDG_DATA_HOME=str(home / ".local" / "share"),
            XDG_CACHE_HOME=str(home / ".cache"),
            XDG_STATE_HOME=str(home / ".local" / "state"),
            TMPDIR=str(self.state / "tmp"),
            PI_TELEMETRY="0",
            PWD=str(self.state / "work"),
        )
        if key is not None:
            env["OCTEN_API_KEY"] = key
        return env

    def command(self, name: str, args: list[str], key: str | None, home: str = "home") -> str:
        done = subprocess.run(
            [self.pi, *args],
            cwd=self.state / "work",
            env=self.env(self.home(home), key),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=300,
        )
        (self.logs / f"{name}.stdout").write_text(done.stdout)
        (self.logs / f"{name}.stderr").write_text(done.stderr)
        return done.stdout + done.stderr

    def session(self, name: str, model: str, prompt: str, key: str | None, extra: list[str], home: str = "home") -> list[dict]:
        """One non-interactive run in JSON mode. Returns the events Pi printed."""
        self.stub.seen.clear()
        args = ["--mode", "json", "--no-context-files", "--session-dir", str(self.logs / f"sessions-{name}"), "--model", model]
        if model.startswith("stub/"):
            # The stand-in never calls a tool, and Pi lists skills only while read is enabled.
            tools = ["--exclude-tools", "bash,edit,write"]
        else:
            # A real model gets only codemode and the MCP tools: with read, bash or edit it could
            # open files under --state, the copied sign-in included, and send them to its provider.
            tools = ["--tools", "codemode"]
        output = self.command(name, [*args, *tools, *extra, prompt], key, home)
        events = []
        for line in output.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict):
                events.append(event)
        if not any(event.get("type") == "message_start" for event in events):
            raise RuntimeError("Pi printed no session events; see the logs for this row")
        return events


def system_prompt(events: list[dict]) -> dict:
    for event in events:
        message = event.get("message") or {}
        if event.get("type") == "message_start" and message.get("role") == "system":
            if message.get("sections", {}).get("project_context"):
                raise RuntimeError("a context file reached the system prompt; the run is not isolated")
            return message
    raise RuntimeError("no system prompt in the session events")


def search_result(events: list[dict]) -> tuple[bool | None, str]:
    """The outcome of the last call to an Octen tool: (isError, result text).

    The model picks the tool, usually mcp__octen__search, sometimes another one such as
    mcp__octen__pulse_search; any of them shows the server and its credential at work.
    """
    outcome: tuple[bool | None, str] = (None, "")
    for event in events:
        if event.get("type") == "tool_execution_end" and str(event.get("toolName", "")).startswith("mcp__octen__"):
            outcome = (bool(event.get("isError")), json.dumps(event.get("result")))
    return outcome


def pack(state: Path) -> Path:
    target = state / "pack"
    target.mkdir()
    subprocess.run(["npm", "pack", "--pack-destination", str(target)], cwd=PACKAGE_DIR, check=True, capture_output=True)
    tarball = next(target.glob("*.tgz"))
    with tarfile.open(tarball) as archive:
        archive.extractall(target, filter="data")
    return target / "package"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pi", required=True, help="path to the pi executable")
    parser.add_argument("--state", required=True, type=Path, help="an empty directory for all Pi state")
    parser.add_argument("--login-state", type=Path, help="an mcp-auth.json written by /mcp login octen")
    parser.add_argument("--only", help="run only the rows whose name contains this text")
    args = parser.parse_args()
    state: Path = args.state.resolve()
    if state.exists() and any(state.iterdir()):
        sys.exit(f"{state} is not empty")
    state.mkdir(parents=True, exist_ok=True)
    state.chmod(0o700)  # the runs leave credentials and tokens under here
    key = os.environ.get("OCTEN_API_KEY", "").strip() or None
    model = None
    if all(os.environ.get(name) for name in ("MODEL_BASE_URL", "MODEL_ID", "MODEL_API_KEY")):
        model = {"base_url": os.environ["MODEL_BASE_URL"], "id": os.environ["MODEL_ID"]}

    stub = Stub()
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    host = Host(args.pi, state, stub, model)
    package = pack(state)
    extension = ["-e", str(package / "src" / "index.ts")]
    version = host.command("version", ["--version"], None).strip().splitlines()[-1]
    print(f"pi {version}; extension packed from {PACKAGE_DIR}")

    real = f"real/{model['id']}" if model else ""
    results: list[tuple[str, str, str]] = []

    def row(name: str, check) -> None:
        if args.only and args.only not in name:
            return
        try:
            status, detail = check()
        except Exception as error:  # a crashed row is a failed row, not a crashed run
            status, detail = "FAIL", f"{type(error).__name__}: {error}"
        results.append((status, name, detail))
        print(f"{status:4}  {name}  |  {detail}", flush=True)

    def need(check, *, a_key: bool = False, a_model: bool = False, a_login: bool = False):
        if a_key and not key:
            return lambda: ("SKIP", "OCTEN_API_KEY is not set")
        if a_model and not model:
            return lambda: ("SKIP", "MODEL_BASE_URL, MODEL_ID and MODEL_API_KEY are not all set")
        if a_login and not args.login_state:
            return lambda: ("SKIP", "--login-state was not given")
        return check

    def control():
        prompt = system_prompt(host.session("control", "stub/model", "hi", key, ["--no-skills"]))
        present = "mcp_servers" in prompt.get("sections", {})
        return ("PASS" if not present else "FAIL"), f"mcp_servers section present: {present}"

    def registered():
        prompt = system_prompt(host.session("registered", "stub/model", "hi", key, ["--no-skills", *extension]))
        section = prompt.get("sections", {}).get("mcp_servers") or ""
        return ("PASS" if "mcp__octen" in section else "FAIL"), f"mcp_servers lists mcp__octen: {'mcp__octen' in section}"

    def call(name: str, the_key: str | None, home: str = "home"):
        return search_result(host.session(name, real, PROMPT, the_key, ["--no-skills", *extension], home))

    def tool_call():
        failed, result = call("call", key)
        ok = failed is False and "http" in result
        return ("PASS" if ok else "FAIL"), f"Octen call isError={failed}; result starts {result[:70]!r}"

    def wrong_key():
        failed, result = call("wrong-key", WRONG_KEY)
        ok = failed is True and "Invalid API Key" in result
        return ("PASS" if ok else "FAIL"), f"Octen call isError={failed}; result starts {result[:90]!r}"

    def login_home() -> None:
        # Copied once per run: Pi refreshes expired tokens in place, and copying the original
        # file back would replace the refreshed tokens with stale ones.
        target = host.home("home-login") / ".pi" / "agent" / "mcp-auth.json"
        if target.exists():
            return
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as out:
            out.write(args.login_state.read_bytes())

    def signed_in():
        login_home()
        failed, result = call("signed-in", None, "home-login")
        ok = failed is False and "http" in result
        return ("PASS" if ok else "FAIL"), f"Octen call isError={failed}; result starts {result[:70]!r}"

    def key_beats_login():
        # First show the sign-in works on its own in this home: a wrong key failing would also be
        # what a missing or expired sign-in looks like.
        login_home()
        failed, _ = call("key-beats-login-nokey", None, "home-login")
        if failed is not False:
            return "FAIL", f"without a key the signed-in call did not succeed (isError={failed}), so the sign-in is not usable"
        failed, result = call("key-beats-login", WRONG_KEY, "home-login")
        ok = failed is True and "Invalid API Key" in result
        return ("PASS" if ok else "FAIL"), f"signed in, no key: succeeded; with a wrong key: isError={failed}, result starts {result[:90]!r}"

    def user_entry():
        # Pi gives an entry in mcp.json precedence over a registered server of the same name.
        # The entry asks for direct exposure. If it is the one in effect, Pi does not list octen
        # among the servers "whose tools are not declared to you", which it does for the
        # extension's own registration (see the row above). That part of the prompt comes from
        # the configuration, so it does not depend on how fast the server connects.
        agent = host.home("home-user-entry") / ".pi" / "agent"
        mine = {"url": f"{MCP_URL}?tools=search", "headers": {"x-api-key": "${OCTEN_API_KEY}"}, "exposure": "direct"}
        (agent / "mcp.json").write_text(json.dumps({"mcpServers": {"octen": mine}}, indent=2))
        # The first prompt can go out before the server has connected, so a run that declared
        # nothing is retried; one that declared anything else is a failure. Three runs were
        # always enough on Pi 1.5.2 and 1.6.0; a slower connection can still end in a FAIL.
        for attempt in (1, 2, 3):
            events = host.session(f"user-entry-{attempt}", "stub/model", "hi", key, ["--no-skills", *extension], "home-user-entry")
            section = system_prompt(events).get("sections", {}).get("mcp_servers") or ""
            declared = sorted({tool for request in stub.seen for tool in request if tool.startswith("mcp__octen__")})
            if declared or "mcp__octen" in section:
                break
        ok = "mcp__octen" not in section and declared == ["mcp__octen__search"]
        return ("PASS" if ok else "FAIL"), f"octen listed as not declared: {'mcp__octen' in section}; declared: {declared} (attempt {attempt})"

    def installed():
        home = "home-install"
        host.home(home)
        install = host.command("install", ["install", str(package)], key, home)
        listing = host.command("list", ["list"], key, home)
        events = host.session("installed", "stub/model", "hi", key, [], home)
        prompt = json.dumps(system_prompt(events))
        ok = "pi-extension" in listing or str(package) in listing
        ok = ok and "mcp__octen" in prompt and "octen-search-guide" in prompt
        detail = f"listed: {'pi-extension' in listing or str(package) in listing}; mcp__octen in prompt: {'mcp__octen' in prompt}; skill in prompt: {'octen-search-guide' in prompt}"
        return ("PASS" if ok else "FAIL"), detail + ("" if ok else f"; install said: {install.strip()[:120]!r}")

    def key_on_disk():
        # Make sure Pi has run with the key, even when --only skipped every other row.
        prompt = system_prompt(host.session("key-on-disk", "stub/model", "hi", key, ["--no-skills", *extension]))
        if "mcp__octen" not in (prompt.get("sections", {}).get("mcp_servers") or ""):
            return "FAIL", "the run with the key did not register the octen server, so the scan would prove nothing"
        hits = scanned = 0
        for path in state.rglob("*"):
            if path.is_file():
                scanned += 1
                hits += key.encode() in path.read_bytes()
        return ("PASS" if hits == 0 else "FAIL"), f"{scanned} files scanned, {hits} contain the key"

    row("no extension: Pi names no MCP server to the model", need(control, a_key=True))
    row("extension: Pi names the octen server to the model", need(registered, a_key=True))
    row("an Octen tool call with the key", need(tool_call, a_key=True, a_model=True))
    row("an Octen tool call with a wrong key", need(wrong_key, a_model=True))
    row("signed in, no key", need(signed_in, a_model=True, a_login=True))
    row("signed in, and a key is set: the key is used", need(key_beats_login, a_model=True, a_login=True))
    row("an octen entry in the user's mcp.json wins", need(user_entry, a_key=True))
    row("installed with pi install: listed, server and skill in the prompt", need(installed, a_key=True))
    row("the key is not written to disk", need(key_on_disk, a_key=True))

    if not results:
        print(f"--only {args.only!r} matched no row")
        return 1
    counts = {status: sum(1 for result in results if result[0] == status) for status in ("PASS", "FAIL", "SKIP")}
    print(f"\n{counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped; logs in {host.logs}")
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
