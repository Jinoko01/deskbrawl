import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("release-version.mjs", import.meta.url));
const paths = {
  pkg: "apps/desktop/package.json",
  config: "apps/desktop/src-tauri/tauri.conf.json",
  cargo: "apps/desktop/src-tauri/Cargo.toml",
};

function fixture(t, version, tagged = true, unreleased = "") {
  const temp = resolve(tmpdir());
  const root = mkdtempSync(join(temp, "deskbrawl-release-"));
  t.after(() => {
    if (dirname(root) === temp && basename(root).startsWith("deskbrawl-release-")) {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  function write(path, content) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const read = (path) => readFileSync(join(root, path), "utf8");
  const commit = (message) => {
    git("add", ".");
    git("commit", "-m", message);
  };
  const tag = (version) => git("tag", "-a", `v${version}`, "-m", "Release notes");
  let changeNumber = 0;
  function change(message, area = "apps/desktop") {
    write(`${area}/change-${++changeNumber}`, "fixture\n");
    commit(message);
  }
  const plan = (channel = "stable", retryTag) => JSON.parse(execFileSync(process.execPath,
    [script, channel, join(root, ".git", "release-notes.md"), ...(retryTag ? [retryTag] : [])],
    { cwd: root, encoding: "utf8", stdio: "pipe" }));

  git("init", "-q");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  write(paths.pkg, JSON.stringify({ version }));
  write(paths.config, JSON.stringify({ version }));
  write(paths.cargo, `[package]\nname = "deskbrawl"\nversion = "${version}"\n`);
  write("CHANGELOG.md", `# Changelog\n\n## [Unreleased]\n${unreleased}`);
  if (!tagged) {
    write("apps/landing/public/downloads/DeskBrawl_1.0.0_x64-setup.exe", "Legacy installer fixture");
  }
  commit("feat: old release feature");
  if (tagged) {
    tag(version);
  }
  return { root, git, read, commit, change, tag, plan };
}

test("bumps from the shipped installer baseline and keeps categorized release notes", (t) => {
  const repo = fixture(t, "1.0.0", false, "\n### Added\n\n- add local profiles\n\n## [1.0.0] - 2026-01-01\n\nInitial release.\n");
  repo.change("fix(auth): renew active sessions");
  repo.change("fix: add local profiles");
  repo.change("fix: website-only change", "apps/landing");
  assert.deepEqual(repo.plan(), { version: "1.1.0", tag: "v1.1.0", prerelease: false });
  assert.equal(JSON.parse(repo.read(paths.pkg)).version, "1.1.0");
  assert.equal(JSON.parse(repo.read(paths.config)).version, "1.1.0");
  assert.match(repo.read(paths.cargo), /version = "1\.1\.0"/);
  assert.match(repo.read("CHANGELOG.md"), /## \[Unreleased\]\n\n## \[1\.1\.0\] - \d{4}-\d{2}-\d{2}/);
  assert.match(repo.read("CHANGELOG.md"), /## \[1\.0\.0\] - 2026-01-01\n\nInitial release\./);
  const notes = repo.read(".git/release-notes.md");
  assert.match(notes, /### Added\n\n- add local profiles/);
  assert.equal(notes.match(/add local profiles/g)?.length, 1);
  assert.match(notes, /### Fixed\n\n- renew active sessions/);
  assert.doesNotMatch(notes, /old release feature|website-only change/);
});

test("does not release maintenance alone and handles stable and initial breaking changes", (t) => {
  const stable = fixture(t, "1.4.2");
  stable.change("docs: clarify configuration");
  stable.change("refactor: simplify internal state");
  assert.deepEqual(stable.plan(), { version: null });
  stable.change("fix: improve a response\n\nBREAKING CHANGE: removes an old response field", "apps/server");
  assert.equal(stable.plan().version, "2.0.0");

  const initial = fixture(t, "0.4.2");
  initial.change("feat(protocol)!: replace a message", "packages/protocol");
  assert.equal(initial.plan().version, "0.5.0");
});

test("numbers and promotes prereleases without consuming Unreleased", (t) => {
  const repo = fixture(t, "1.4.2");
  repo.change("perf: speed up room entry\n\nRelease-As: patch\nChangelog: Changed");
  const unreleased = repo.read("CHANGELOG.md");
  for (const [channel, version] of [
    ["alpha", "1.4.3-alpha.1"], ["alpha", "1.4.3-alpha.2"], ["beta", "1.4.3-beta.1"], ["rc", "1.4.3-rc.1"],
  ]) {
    assert.deepEqual(repo.plan(channel), { version, tag: `v${version}`, prerelease: true });
    assert.equal(repo.read("CHANGELOG.md"), unreleased);
    repo.commit(`chore(release): v${version}`);
    repo.tag(version);
  }
  assert.throws(() => repo.plan("alpha"), /later prerelease channel/);
  assert.equal(repo.plan().version, "1.4.3");
  repo.commit("chore(release): v1.4.3");
  repo.tag("1.4.3");
  assert.equal(repo.plan().version, null);
  assert.deepEqual(repo.plan("stable", "v1.4.3"), { version: "1.4.3", tag: "v1.4.3", prerelease: false });
  assert.equal(repo.read(".git/release-notes.md"), "Release notes\n");
});
