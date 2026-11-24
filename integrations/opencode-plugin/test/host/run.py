#!/usr/bin/env python3
"""Host tests for @octen.ai/opencode-plugin.

Drives a real OpenCode install with the packed plugin and a local stand-in for the model, and
checks what OpenCode offers the model and what a tool call returns.

    npm run build
    OCTEN_API_KEY=<key> python3 test/host/run.py --opencode <path to opencode> --state <empty dir> \
        [--login-state <mcp-auth.json from a browser sign-in>]

These checks do not run in CI: they need the network and the hosted Octen MCP server, the tool
call rows need a real key (one billed search), and the sign-in rows need a credential file that
only a person can produce. A row whose precondition is missing prints SKIP, which is not a pass.
All OpenCode state goes under --state; nothing touches the real OpenCode configuration.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MCP_URL = "https://mcp.octen.ai/mcp"
PACKAGE = "@octen.ai/opencode-plugin"
WRONG_KEY = "your-api-key"
PACKAGE_DIR = Path(__file__).resolve().parents[2]


class Stub(ThreadingHTTPServer):
    """An OpenAI-compatible endpoint that records the tool names of each request.

    It answers "ok", or, when `call` is set, asks for that one tool call first.
    """

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), StubHandler)
        self.seen: list[list[str]] = []
        self.call: dict | None = None


class StubHandler(BaseHTTPRequestHandler):
    server: Stub

    def log_message(self, *args: object) -> None:  # keep the test output clean
        pass

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        names = [tool.get("function", {}).get("name") for tool in body.get("tools") or []]
        self.server.seen.append([name for name in names if name])
        answered = any(message.get("role") == "tool" for message in body.get("messages", []))
        call = self.server.call if names and not answered else None

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
        if call:
            function = {"name": call["name"], "arguments": json.dumps(call["arguments"])}
            tool_call = {"index": 0, "id": "call_1", "type": "function", "function": function}
            self.wfile.write(chunk({"role": "assistant", "tool_calls": [tool_call]}))
            self.wfile.write(chunk({}, "tool_calls"))
        else:
            self.wfile.write(chunk({"role": "assistant", "content": "ok"}))
            self.wfile.write(chunk({}, "stop"))
        self.wfile.write(b"data: [DONE]\n\n")


class Host:
    def __init__(self, opencode: str, state: Path, stub: Stub) -> None:
        self.opencode = opencode
        self.state = state
        self.stub = stub
        self.logs = state / "logs"
        self.logs.mkdir(parents=True)

    def home(self, name: str = "home") -> Path:
        home = self.state / name
        config = home / ".config" / "opencode"
        if not config.exists():
            config.mkdir(parents=True)
            provider = {
                "npm": "@ai-sdk/openai-compatible",
                "options": {"baseURL": "{env:STUB_BASE_URL}", "apiKey": "stub"},
                "models": {"model": {"name": "stub"}},
            }
            settings = {"provider": {"stub": provider}, "model": "stub/model", "autoupdate": False, "share": "disabled"}
            (config / "opencode.json").write_text(json.dumps(settings, indent=2))
        return home

    def env(self, home: Path, key: str | None) -> dict[str, str]:
        env = {name: value for name, value in os.environ.items() if name != "OCTEN_API_KEY"}
        env.update(
            HOME=str(home),
            XDG_CONFIG_HOME=str(home / ".config"),
            XDG_DATA_HOME=str(home / ".local" / "share"),
            XDG_CACHE_HOME=str(home / ".cache"),
            XDG_STATE_HOME=str(home / ".local" / "state"),
            TMPDIR=str(self.state / "tmp"),
            OPENCODE_DISABLE_AUTOUPDATE="1",
            OPENCODE_DISABLE_SHARE="1",
            OPENCODE_PERMISSION=json.dumps({name: "deny" for name in ["edit", "bash", "task", "webfetch", "external_directory"]}),
            STUB_BASE_URL=f"http://127.0.0.1:{self.stub.server_address[1]}/v1",
        )
        if key is not None:
            env["OCTEN_API_KEY"] = key
        return env

    def workdir(self, name: str, config: dict) -> Path:
        work = self.state / "work" / name
        work.mkdir(parents=True)
        (work / "opencode.json").write_text(json.dumps(config, indent=2))
        return work

    def command(self, name: str, work: Path, args: list[str], key: str | None, home: str = "home") -> str:
        (self.state / "tmp").mkdir(exist_ok=True)
        # OpenCode takes the project directory from PWD, which subprocess does not update.
        env = {**self.env(self.home(home), key), "PWD": str(work)}
        try:
            done = subprocess.run(
                [self.opencode, *args],
                cwd=work,
                env=env,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=900,
            )
        except subprocess.TimeoutExpired as late:
            for stream, text in (("stdout", late.stdout), ("stderr", late.stderr)):
                (self.logs / f"{name}.{stream}").write_bytes(text or b"")
            raise
        (self.logs / f"{name}.stdout").write_text(done.stdout)
        (self.logs / f"{name}.stderr").write_text(done.stderr)
        return done.stdout + done.stderr

    def agent(self, name: str, work: Path, key: str | None, call: dict | None = None, home: str = "home") -> tuple[set[str], list[dict]]:
        """One headless run. Returns the Octen tools the model was offered and the tool calls made."""
        self.stub.seen.clear()
        self.stub.call = call
        output = self.command(name, work, ["run", "--format", "json", "hi"], key, home)
        if not any(self.stub.seen):
            # Without this, a run that never reached the model would read as "no Octen tools".
            raise RuntimeError("OpenCode offered the model no tools at all; see the logs for this row")
        offered = {tool for request in self.stub.seen for tool in request if tool.startswith("octen_")}
        calls = []
        for line in output.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get("type") == "tool_use":
                calls.append(event.get("part", {}))
        return offered, calls


def hosted_tools(key: str) -> set[str]:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}).encode()
    headers = {"content-type": "application/json", "accept": "application/json, text/event-stream", "x-api-key": key}
    with urllib.request.urlopen(urllib.request.Request(MCP_URL, data=payload, headers=headers), timeout=60) as response:
        body = response.read().decode()
    if not body.lstrip().startswith("{"):  # a server-sent event stream: take the data lines
        body = "\n".join(line[5:].lstrip() for line in body.splitlines() if line.startswith("data:"))
    return {tool["name"] for tool in json.loads(body)["result"]["tools"]}


def pack(state: Path) -> Path:
    if not (PACKAGE_DIR / "dist" / "server.js").exists():
        sys.exit("dist/server.js is missing: run `npm run build` first")
    target = state / "pack"
    target.mkdir()
    subprocess.run(["npm", "pack", "--pack-destination", str(target)], cwd=PACKAGE_DIR, check=True, capture_output=True)
    tarball = next(target.glob("*.tgz"))
    with tarfile.open(tarball) as archive:
        archive.extractall(target, filter="data")
    return target / "package"


def install_in_cache(home: Path, spec: str, package: Path, engines: str | None = None) -> None:
    """Puts the packed plugin where OpenCode keeps npm plugins, so a package-name spec loads it."""
    installed = home / ".cache" / "opencode" / "packages" / spec / "node_modules" / PACKAGE
    shutil.copytree(package, installed)
    if engines:
        manifest = json.loads((installed / "package.json").read_text())
        manifest["engines"]["opencode"] = engines
        (installed / "package.json").write_text(json.dumps(manifest, indent=2))


def call_state(calls: list[dict]) -> tuple[str, str]:
    for part in calls:
        if part.get("tool") == "octen_search":
            state = part.get("state", {})
            return state.get("status", ""), str(state.get("output") or state.get("error") or "")
    return "", ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--opencode", required=True, help="path to the opencode executable")
    parser.add_argument("--state", required=True, type=Path, help="an empty directory for all OpenCode state")
    parser.add_argument("--login-state", type=Path, help="an mcp-auth.json written by `opencode mcp auth octen`")
    parser.add_argument("--only", help="run only the rows whose name contains this text")
    args = parser.parse_args()
    state: Path = args.state.resolve()
    if state.exists() and any(state.iterdir()):
        sys.exit(f"{state} is not empty")
    state.mkdir(parents=True, exist_ok=True)
    key = os.environ.get("OCTEN_API_KEY", "").strip() or None

    stub = Stub()
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    host = Host(args.opencode, state, stub)
    package = pack(state)
    plugin = str(package)
    version = host.command("version", host.workdir("version", {}), ["--version"], None).strip().splitlines()[-1]
    print(f"opencode {version}; plugin packed from {PACKAGE_DIR}")

    # The first run that loads any plugin makes OpenCode install its plugin runtime into the
    # config directory, which can take minutes. Do it once here so no row pays for it.
    started = time.time()
    host.agent("warm-up", host.workdir("warm-up", {"plugin": [plugin]}), WRONG_KEY)
    print(f"warm-up: first plugin load in a new OpenCode home took {time.time() - started:.0f} s")

    search = {"name": "octen_search", "arguments": {"query": "latest Node.js LTS release", "count": 1}}
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

    def need_key(check):
        return check if key else (lambda: ("SKIP", "OCTEN_API_KEY is not set"))

    def control():
        offered, _ = host.agent("control", host.workdir("control", {}), key)
        return ("PASS" if not offered else "FAIL"), f"octen tools offered: {len(offered)}"

    def with_plugin():
        offered, _ = host.agent("plugin", host.workdir("plugin", {"plugin": [plugin]}), key)
        expected = {f"octen_{name}" for name in hosted_tools(key)}
        ok = offered == expected and len(expected) > 0
        return ("PASS" if ok else "FAIL"), f"offered {len(offered)}, hosted roster {len(expected)}, difference {sorted(offered ^ expected)}"

    def tools_option():
        config = {"plugin": [[plugin, {"tools": ["search", "extract"]}]]}
        offered, _ = host.agent("tools", host.workdir("tools", config), key)
        return ("PASS" if offered == {"octen_search", "octen_extract"} else "FAIL"), f"offered {sorted(offered)}"

    def unknown_tool():
        work = host.workdir("unknown-tool", {"plugin": [[plugin, {"tools": ["nope"]}]]})
        offered, _ = host.agent("unknown-tool", work, key)
        listing = host.command("unknown-tool-list", work, ["mcp", "list"], key)
        line = next((text.strip() for text in listing.splitlines() if "octen" in text), "")
        ok = not offered and "octen" in line and "connected" not in line
        return ("PASS" if ok else "FAIL"), f"octen tools offered: {len(offered)}; mcp list says: {line!r}"

    def user_entry():
        mine = {"type": "remote", "url": f"{MCP_URL}?tools=search", "oauth": False, "headers": {"x-api-key": "{env:OCTEN_API_KEY}"}}
        offered, _ = host.agent("user-entry", host.workdir("user-entry", {"plugin": [plugin], "mcp": {"octen": mine}}), key)
        return ("PASS" if offered == {"octen_search"} else "FAIL"), f"offered {sorted(offered)}"

    def tool_call():
        _, calls = host.agent("call", host.workdir("call", {"plugin": [plugin]}), key, search)
        status, output = call_state(calls)
        ok = status == "completed" and "http" in output
        return ("PASS" if ok else "FAIL"), f"status {status!r}; output starts {output[:60]!r}"

    def wrong_key():
        _, calls = host.agent("wrong-key", host.workdir("wrong-key", {"plugin": [plugin]}), WRONG_KEY, search)
        status, output = call_state(calls)
        ok = status == "error" and "Invalid API Key" in output
        return ("PASS" if ok else "FAIL"), f"status {status!r}; error {output[:80]!r}"

    def by_name():
        home = host.home("home-npm")
        install_in_cache(home, f"{PACKAGE}@latest", package)
        install_in_cache(home, f"{PACKAGE}@0.0.1", package, engines=">=99.0.0 <100")
        offered, _ = host.agent("by-name", host.workdir("by-name", {"plugin": [PACKAGE]}), key, home="home-npm")
        refused, _ = host.agent("by-name-engines", host.workdir("by-name-engines", {"plugin": [f"{PACKAGE}@0.0.1"]}), key, home="home-npm")
        ok = len(offered) > 0 and not refused
        return ("PASS" if ok else "FAIL"), f"by package name: {len(offered)} octen tools; with an engines range this OpenCode does not satisfy: {len(refused)}"

    def skill():
        output = host.command("skill", host.workdir("skill", {"plugin": [plugin]}), ["debug", "skill"], key)
        return ("PASS" if "octen-search-guide" in output else "FAIL"), f"octen-search-guide listed: {'octen-search-guide' in output}"

    def signed_out():
        offered, _ = host.agent("signed-out", host.workdir("signed-out", {"plugin": [plugin]}), None, home="home-signed-out")
        return ("PASS" if not offered else "FAIL"), f"octen tools offered: {len(offered)}"

    def login_home() -> None:
        target = host.home("home-login") / ".local" / "share" / "opencode"
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.login_state, target / "mcp-auth.json")

    def need_login(check):
        if not args.login_state:
            return lambda: ("SKIP", "--login-state was not given")
        return check

    def signed_in():
        login_home()
        work = host.workdir("signed-in", {"plugin": [plugin]})
        listing = host.command("signed-in-list", work, ["mcp", "list"], None, "home-login")
        line = next((text.strip() for text in listing.splitlines() if "octen" in text), "")
        _, calls = host.agent("signed-in", work, None, search, "home-login")
        status, output = call_state(calls)
        ok = "connected" in line and status == "completed" and "http" in output
        return ("PASS" if ok else "FAIL"), f"mcp list says: {line!r}; call status {status!r}"

    def key_beats_login():
        _, calls = host.agent("key-beats-login", host.workdir("key-beats-login", {"plugin": [plugin]}), WRONG_KEY, search, "home-login")
        status, output = call_state(calls)
        ok = status == "error" and "Invalid API Key" in output
        return ("PASS" if ok else "FAIL"), f"status {status!r}; error {output[:80]!r}"

    def key_on_disk():
        hits = scanned = 0
        for path in state.rglob("*"):
            if path.is_file():
                scanned += 1
                hits += key.encode() in path.read_bytes()
        return ("PASS" if hits == 0 else "FAIL"), f"{scanned} files scanned, {hits} contain the key"

    row("no plugin: the model gets no Octen tool", need_key(control))
    row("plugin: the model gets the hosted roster", need_key(with_plugin))
    row('option tools: ["search", "extract"]', need_key(tools_option))
    row('option tools: ["nope"]', need_key(unknown_tool))
    row("an octen entry in the user's config wins", need_key(user_entry))
    row("octen_search with the key", need_key(tool_call))
    row("octen_search with a wrong key", wrong_key)
    row("loaded by package name, and refused on an engines mismatch", need_key(by_name))
    row("the bundled skill is discovered", need_key(skill))
    row("no key and not signed in", signed_out)
    row("signed in, no key", need_login(signed_in))
    row("signed in, and a key is set: the key is used", need_login(key_beats_login))
    row("the key is not written to disk", need_key(key_on_disk))

    counts = {status: sum(1 for result in results if result[0] == status) for status in ("PASS", "FAIL", "SKIP")}
    print(f"\n{counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped; logs in {host.logs}")
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
