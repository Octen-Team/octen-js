#!/usr/bin/env python3
"""Host tests for @octen.ai/opencode-plugin on OpenCode 2.x.

Drives a real OpenCode 2.x install (npm @opencode/cli) with the packed plugin and a local
stand-in for the model. OpenCode 2.x runs MCP tools in Code Mode, so the stand-in asks for
`execute` with a script that lists or calls the Octen tools, and the rows read its result.

    npm run build
    OCTEN_API_KEY=<key> python3 test/host/run_v2.py --opencode <path to opencode 2.x> --state <empty dir>

Like run.py, this needs the network and the hosted Octen MCP server, and the tool call row
makes one billed search. Browser sign-in is not covered here: on 2.x it is checked by hand.
A row whose precondition is missing prints SKIP, which is not a pass.
OpenCode 2.x runs a background service per home; every row stops it when done, and the run
stops it on exit. All OpenCode state goes under --state, which must be outside any project.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from run import MCP_URL, PACKAGE_DIR, WRONG_KEY, Stub, hosted_tools, pack

LIST_OCTEN = 'const r = await search({ namespace: "octen", limit: 100 }); return r.items.map((i) => i.path);'
CALL_SEARCH = 'return await tools.octen.search({ query: "latest Node.js LTS release", count: 1 });'


def execute(code: str) -> dict:
    return {"name": "execute", "arguments": {"code": code}}


class Host:
    def __init__(self, opencode: str, state: Path, stub: Stub) -> None:
        self.opencode = str(Path(opencode).resolve()) if os.sep in opencode else opencode
        self.state = state
        self.stub = stub
        self.logs = state / "logs"
        self.logs.mkdir(parents=True)
        self.home = state / "home"
        config = self.home / ".config" / "opencode"
        config.mkdir(parents=True)
        provider = {
            "package": "@opencode/ai/providers/openai-compatible",
            "settings": {"baseURL": f"http://127.0.0.1:{stub.server_address[1]}/v1", "apiKey": "stub"},
            "models": {"model": {}},
        }
        (config / "opencode.jsonc").write_text(json.dumps({"providers": {"stub": provider}, "model": "stub/model"}, indent=2))
        (state / "tmp").mkdir()
        self.service_key: object = "none started"
        self.last_exit = 0

    def env(self, key: str | None, work: Path) -> dict[str, str]:
        env = {name: value for name, value in os.environ.items() if name != "OCTEN_API_KEY" and not name.startswith("OPENCODE_")}
        home = self.home
        env.update(
            HOME=str(home),
            XDG_CONFIG_HOME=str(home / ".config"),
            XDG_DATA_HOME=str(home / ".local" / "share"),
            XDG_CACHE_HOME=str(home / ".cache"),
            XDG_STATE_HOME=str(home / ".local" / "state"),
            OPENCODE_TEST_HOME=str(home),
            TMPDIR=str(self.state / "tmp"),
            PWD=str(work),
        )
        if key is not None:
            env["OCTEN_API_KEY"] = key
        return env

    def workdir(self, name: str, config: dict) -> Path:
        work = self.state / "work" / name
        work.mkdir(parents=True)
        (work / "opencode.jsonc").write_text(json.dumps(config, indent=2))
        return work

    def raw(self, name: str, work: Path, args: list[str], key: str | None) -> str:
        done = subprocess.run(
            [self.opencode, *args], cwd=work, env=self.env(key, work), stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=900,
        )
        (self.logs / f"{name}.stdout").write_text(done.stdout)
        (self.logs / f"{name}.stderr").write_text(done.stderr)
        self.last_exit = done.returncode
        return done.stdout + done.stderr

    def stop(self) -> None:
        self.raw("service-stop", self.state, ["service", "stop"], None)
        status = self.raw("service-status", self.state, ["service", "status"], None).strip()
        # A service that survives would hand the next row this row's environment.
        if status.splitlines()[-1:] != ["stopped"]:
            raise RuntimeError(f"the OpenCode service did not stop: `service status` says {status!r}")
        self.service_key = "none started"

    def command(self, name: str, work: Path, args: list[str], key: str | None) -> str:
        # The service takes its environment from the command that starts it, so a row with a
        # different key needs a fresh service.
        if self.service_key != key:
            self.stop()
            self.service_key = key
        return self.raw(name, work, args, key)

    def octen_line(self, name: str, work: Path, key: str | None, wait: float = 40) -> str:
        """Polls `mcp list` until octen leaves the pending state; MCP servers connect in the background."""
        deadline = time.time() + wait
        line = ""
        while time.time() < deadline:
            listing = self.command(name, work, ["mcp", "list"], key)
            # A listing that failed says nothing about which servers are registered.
            if self.last_exit != 0:
                raise RuntimeError(f"`opencode mcp list` exited with {self.last_exit}; see {name}.stderr")
            line = next((text.strip() for text in listing.splitlines() if "octen" in text), "")
            if line and "pending" not in line:
                return line
            time.sleep(2)
        return line

    def agent(self, name: str, work: Path, key: str | None, code: str) -> tuple[str, str]:
        """One headless run in which the model runs `code` in Code Mode. Returns the tool status and output."""
        return self.call_tool(name, work, key, execute(code))

    def call_tool(self, name: str, work: Path, key: str | None, call: dict) -> tuple[str, str]:
        """One headless run in which the model makes `call`. Returns the tool status and output."""
        self.stub.seen.clear()
        self.stub.bodies.clear()
        self.stub.call = call
        output = self.command(name, work, ["run", "--auto", "--format", "json", "hi"], key)
        if self.last_exit != 0:
            raise RuntimeError(f"`opencode run` exited with {self.last_exit}; see {name}.stderr")
        for line in output.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get("type") == "tool_use" and event.get("part", {}).get("tool") == call["name"]:
                state = event["part"].get("state", {})
                return state.get("status", ""), str(state.get("output") or state.get("error") or "")
        raise RuntimeError(f"the run made no {call['name']} call; see the logs for this row")

    def listed(self, name: str, work: Path, key: str | None) -> set[str]:
        status, output = self.agent(name, work, key, LIST_OCTEN)
        if status != "completed":
            raise RuntimeError(f"listing the octen namespace failed: {status} {output[:200]}")
        return {path.removeprefix("tools.octen.") for path in json.loads(output)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--opencode", required=True, help="path to the opencode 2.x executable")
    parser.add_argument("--state", required=True, type=Path, help="an empty directory for all OpenCode state")
    parser.add_argument("--only", help="run only the rows whose name contains this text")
    args = parser.parse_args()
    state: Path = args.state.resolve()
    if state.exists() and any(state.iterdir()):
        sys.exit(f"{state} is not empty")
    state.mkdir(parents=True, exist_ok=True)
    state.chmod(0o700)
    key = os.environ.get("OCTEN_API_KEY", "").strip() or None

    stub = Stub()
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    host = Host(args.opencode, state, stub)
    plugin = str(pack(state))
    version = host.raw("version", state, ["--version"], None).strip().splitlines()[-1]
    print(f"opencode {version}; plugin packed from {PACKAGE_DIR}")
    if not version.startswith("opencode v2."):
        sys.exit("this script is for OpenCode 2.x; use run.py for 1.x")

    results: list[tuple[str, str, str]] = []

    def row(name: str, check) -> None:
        if args.only and args.only not in name:
            return
        try:
            status, detail = check()
        except Exception as error:
            status, detail = "FAIL", f"{type(error).__name__}: {error}"
        try:
            host.stop()
        except Exception as error:  # a row that leaves the service running fails
            status, detail = "FAIL", f"{detail}; {error}"
        results.append((status, name, detail))
        print(f"{status:4}  {name}  |  {detail}", flush=True)

    def need_key(check):
        return check if key else (lambda: ("SKIP", "OCTEN_API_KEY is not set"))

    def control():
        work = host.workdir("control", {})
        found = host.listed("control", work, key)
        return ("PASS" if not found else "FAIL"), f"octen tools found: {len(found)}"

    def with_plugin():
        work = host.workdir("plugin", {"plugins": [plugin]})
        line = host.octen_line("plugin-list", work, key)
        found = host.listed("plugin", work, key)
        expected = hosted_tools(key)
        ok = "connected" in line and found == expected and len(expected) > 0
        return ("PASS" if ok else "FAIL"), f"mcp list says {line!r}; found {len(found)}, hosted roster {len(expected)}, difference {sorted(found ^ expected)}"

    def v1_key():
        work = host.workdir("v1-key", {"plugin": [plugin]})
        line = host.octen_line("v1-key-list", work, key)
        return ("PASS" if "connected" in line else "FAIL"), f"a 1.x \"plugin\" entry: mcp list says {line!r}"

    def tools_option():
        work = host.workdir("tools", {"plugins": [{"package": plugin, "options": {"tools": ["search", "extract"]}}]})
        line = host.octen_line("tools-list", work, key)
        found = host.listed("tools", work, key)
        return ("PASS" if found == {"search", "extract"} else "FAIL"), f"mcp list says {line!r}; found {sorted(found)}"

    def unknown_option():
        work = host.workdir("bad-option", {"plugins": [{"package": plugin, "options": {"tool": ["search"]}}]})
        line = host.octen_line("bad-option-list", work, key, wait=15)
        # The service writes why a plugin failed to its log, not to the command's output.
        log = host.home / ".local" / "share" / "opencode" / "log" / "opencode.log"
        text = log.read_text(errors="replace") if log.exists() else ""
        reported = "failed to load plugin" in text and '@octen.ai/opencode-plugin: unknown option \\"tool\\"' in text
        ok = line == "" and reported
        return ("PASS" if ok else "FAIL"), f"octen in mcp list: {line!r}; the service log names the bad option: {reported}"

    def user_entry():
        mine = {"type": "remote", "url": f"{MCP_URL}?tools=search", "oauth": False, "headers": {"x-api-key": "{env:OCTEN_API_KEY}"}}
        work = host.workdir("user-entry", {"plugins": [plugin], "mcp": {"servers": {"octen": mine}}})
        line = host.octen_line("user-entry-list", work, key)
        found = host.listed("user-entry", work, key)
        # The hand-written entry alone would also give exactly "search"; the skill shows the plugin ran.
        loaded = bool(stub.bodies) and "<id>octen-search-guide</id>" in json.dumps(stub.bodies[-1]["messages"])
        ok = found == {"search"} and loaded
        return ("PASS" if ok else "FAIL"), f"mcp list says {line!r}; found {sorted(found)}; plugin loaded (skill offered): {loaded}"

    def tool_call():
        work = host.workdir("call", {"plugins": [plugin]})
        host.octen_line("call-list", work, key)
        status, output = host.agent("call", work, key, CALL_SEARCH)
        ok = status == "completed" and "http" in output
        return ("PASS" if ok else "FAIL"), f"status {status!r}; output starts {output[:60]!r}"

    def wrong_key():
        work = host.workdir("wrong-key", {"plugins": [plugin]})
        line = host.octen_line("wrong-key-list", work, WRONG_KEY)
        status, output = host.agent("wrong-key", work, WRONG_KEY, CALL_SEARCH)
        ok = "Invalid API Key" in output
        return ("PASS" if ok else "FAIL"), f"mcp list says {line!r}; status {status!r}; output {output[:100]!r}"

    def skill():
        work = host.workdir("skill", {"plugins": [plugin]})
        host.octen_line("skill-list", work, key)
        host.agent("skill", work, key, "return 1;")
        prompt = json.dumps(stub.bodies[-1]["messages"]) if stub.bodies else ""
        ok = "<id>octen-search-guide</id>" in prompt
        return ("PASS" if ok else "FAIL"), f"octen-search-guide offered to the model: {ok}"

    def skill_opens():
        # Listing is not enough: OpenCode reads the skill's file location when the model opens it.
        work = host.workdir("skill-open", {"plugins": [plugin]})
        host.octen_line("skill-open-list", work, key)
        status, output = host.call_tool("skill-open", work, key, {"name": "skill", "arguments": {"id": "octen-search-guide"}})
        ok = status == "completed" and "# Octen search guide" in output
        return ("PASS" if ok else "FAIL"), f"status {status!r}; guide text returned: {'# Octen search guide' in output}"

    def signed_out():
        work = host.workdir("signed-out", {"plugins": [plugin]})
        line = host.octen_line("signed-out-list", work, None)
        found = host.listed("signed-out", work, None)
        ok = "needs authentication" in line and not found
        return ("PASS" if ok else "FAIL"), f"mcp list says {line!r}; octen tools found: {len(found)}"

    def service_env():
        # The documented way to give the 2.x service a key. A wrong key is enough: with a key the
        # plugin turns sign-in off and the server connects; without one it waits for a sign-in.
        work = host.workdir("service-env", {"plugins": [plugin]})
        host.stop()
        host.raw("service-env-set", work, ["service", "set", "env", "OCTEN_API_KEY", WRONG_KEY], None)
        try:
            host.service_key = None
            line = host.octen_line("service-env-list", work, None)
        finally:
            host.raw("service-env-unset", work, ["service", "unset", "env", "OCTEN_API_KEY"], None)
        ok = "connected" in line
        return ("PASS" if ok else "FAIL"), f"key only in `service set env`: mcp list says {line!r}"

    def key_on_disk():
        work = host.workdir("key-on-disk", {"plugins": [plugin]})
        host.octen_line("key-on-disk-list", work, key)
        # A wrong key also connects, so only an authenticated call shows OpenCode used this key.
        status, output = host.agent("key-on-disk", work, key, CALL_SEARCH)
        if status != "completed" or "http" not in output:
            return "FAIL", f"the call with the key did not succeed ({status!r}), so the scan would prove nothing"
        host.stop()
        hits = scanned = 0
        for path in state.rglob("*"):
            if path.is_file():
                scanned += 1
                hits += key.encode() in path.read_bytes()
        return ("PASS" if hits == 0 else "FAIL"), f"{scanned} files scanned, {hits} contain the key"

    try:
        row("no plugin: no Octen tool in Code Mode", need_key(control))
        row("plugin: Code Mode has the hosted roster", need_key(with_plugin))
        row('a 1.x "plugin" entry is read', need_key(v1_key))
        row('option tools: ["search", "extract"]', need_key(tools_option))
        row("a misspelt option: the server is not registered", need_key(unknown_option))
        row("an octen entry under mcp.servers wins", need_key(user_entry))
        row("tools.octen.search with the key", need_key(tool_call))
        row("tools.octen.search with a wrong key", wrong_key)
        row("the bundled skill is offered", need_key(skill))
        row("the bundled skill opens", need_key(skill_opens))
        row("no key and not signed in", signed_out)
        row("a key set with `opencode service set env`", service_env)
        row("the key is not written to disk", need_key(key_on_disk))
    finally:
        host.stop()

    if not results:
        print(f"--only {args.only!r} matched no row")
        return 1
    counts = {status: sum(1 for result in results if result[0] == status) for status in ("PASS", "FAIL", "SKIP")}
    print(f"\n{counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped; logs in {host.logs}")
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
