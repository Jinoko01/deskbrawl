import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const channels = ["alpha", "beta", "rc", "stable"];
const levels = ["none", "patch", "minor", "major"];
const categories = { Added: "minor", Changed: "patch", Deprecated: "minor", Removed: "major", Fixed: "patch", Security: "patch" };
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const tagFormat = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;
const packagePath = "apps/desktop/package.json";
const tauriPath = "apps/desktop/src-tauri/tauri.conf.json";
const cargoPath = "apps/desktop/src-tauri/Cargo.toml";
const cargoLockPath = "apps/desktop/src-tauri/Cargo.lock";
const changelogPath = "CHANGELOG.md";
const legacyVersion = "1.0.0";
const legacyInstaller = `apps/landing/public/downloads/DeskBrawl_${legacyVersion}_x64-setup.exe`;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function classify(commit) {
  const [subject, ...body] = commit.trim().split(/\r?\n/);
  const header = /^([a-z]+)(?:\([^)]+\))?(!)?: (.+)$/.exec(subject);
  const [, type, incompatible, description = subject] = header ?? [];
  const trailers = body.join("\n");
  const breaking = incompatible || /^BREAKING(?: |-)CHANGE:/m.test(trailers);
  const requested = /^Release-As: (patch|minor|major)\s*$/im.exec(trailers)?.[1]?.toLowerCase();
  const category = /^Changelog: (Added|Changed|Deprecated|Removed|Fixed|Security)\s*$/m.exec(trailers)?.[1];
  const implicit = breaking ? "major" : { feat: "minor", fix: "patch", security: "patch" }[type];
  const rank = Math.max(0, levels.indexOf(implicit), levels.indexOf(requested), levels.indexOf(categories[category]));
  let group = category ?? "Changed";
  if (category === undefined && !breaking) {
    if (type === "feat") {
      group = "Added";
    } else if (type === "fix") {
      group = "Fixed";
    } else if (type === "security") {
      group = "Security";
    }
  }
  const note = (description ?? subject).replace(/[\\`*_\[\]<>]/g, "\\$&").replaceAll("@", "\\@");
  return { rank, group, note };
}

function nextVersion(version, level) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (level === "major" && major > 0) {
    return `${major + 1}.0.0`;
  }
  if (level !== "patch") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function readVersionFiles(requireMatch = true) {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const config = JSON.parse(readFileSync(tauriPath, "utf8"));
  const cargo = readFileSync(cargoPath, "utf8");
  const cargoVersion = /^version = "([^"]+)"\r?$/m.exec(cargo)?.[1];
  if (![pkg.version, config.version, cargoVersion].every((version) => tagFormat.test(`v${version}`))) {
    throw new Error("The desktop package, Tauri and Cargo files must each have a valid version.");
  }
  if (requireMatch && (pkg.version !== config.version || cargoVersion !== config.version)) {
    throw new Error("The desktop package, Tauri and Cargo versions must agree.");
  }
  return { pkg, config, cargo };
}

function writeVersionFiles(files, version) {
  for (const [path, json] of [[packagePath, files.pkg], [tauriPath, files.config]]) {
    json.version = version;
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  }
  writeFileSync(cargoPath, files.cargo.replace(/^version = "[^"]+"/m, () => `version = "${version}"`));
}

function setVersion(version) {
  if (!tagFormat.test(`v${version}`)) {
    throw new Error("Usage: pnpm desktop:version 1.1.0 (or 1.1.0-rc.1)");
  }
  const files = readVersionFiles(false);
  const originals = [packagePath, tauriPath, cargoPath, cargoLockPath].map((path) => [path, readFileSync(path)]);
  try {
    writeVersionFiles(files, version);
    execFileSync("cargo", ["update", "--manifest-path", cargoPath, "-p", "deskbrawl", "--offline"], { stdio: "inherit" });
  } catch (error) {
    for (const [path, original] of originals) {
      writeFileSync(path, original);
    }
    throw error;
  }
  console.log(`Desktop version set to ${version} in package.json, tauri.conf.json, Cargo.toml and Cargo.lock.`);
}

function prepare(channel, notesPath) {
  const files = readVersionFiles();
  const tags = git("tag", "--list", "v*", "--sort=-version:refname").split("\n").filter((tag) => tagFormat.test(tag));
  const previous = tags.find((tag) => stable.test(tag.slice(1)));
  const baseline = previous ?? git("log", "-1", "--diff-filter=A", "--format=%H", "--", legacyInstaller);
  if (!baseline) {
    throw new Error("Could not find a previous release or the original 1.0.0 installer commit.");
  }
  git("merge-base", "--is-ancestor", baseline, "HEAD");
  const commits = git("log", "--no-merges", "--reverse", "-z", "--format=%B", `${baseline}..HEAD`, "--",
    "apps/desktop", "apps/server", "packages", "patches", "pnpm-lock.yaml", "compose.prod.yaml", "deploy");
  const changes = commits.split("\0").filter((entry) => entry.trim()).map(classify).filter(({ rank }) => rank > 0);
  const log = readFileSync(changelogPath, "utf8").replaceAll("\r\n", "\n");
  const unreleased = /^(## \[Unreleased\])\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(log);
  if (!unreleased) {
    throw new Error("CHANGELOG.md needs an Unreleased section.");
  }
  const curated = new Map();
  const publicNotes = new Set();
  for (const section of unreleased[2].trim().split(/(?=^### )/m).filter(Boolean)) {
    const [heading, ...lines] = section.trimEnd().split("\n");
    const name = heading.slice(4).trimEnd();
    if (heading.trimEnd() === "### 공지사항") {
      for (const line of lines.filter((line) => line.trim())) {
        if (!/^- \S/.test(line)) {
          throw new Error("Write each public update note on one line starting with '- '.");
        }
        publicNotes.add(line.trimEnd());
      }
      continue;
    }
    if (!heading.startsWith("### ") || !Object.hasOwn(categories, name)) {
      throw new Error("Use Keep a Changelog headings or '### 공지사항' for Unreleased notes.");
    }
    curated.set(name, [...(curated.get(name) ?? []), ...lines]);
  }
  const curatedRank = [...curated].filter(([, lines]) => lines.some((line) => line.trim()))
    .map(([name]) => levels.indexOf(categories[name]));
  const rank = Math.max(0, ...curatedRank, ...changes.map((change) => change.rank));
  if (rank === 0) {
    return { version: null };
  }

  let version = nextVersion(previous?.slice(1) ?? legacyVersion, levels[rank]);
  if (channel !== "stable") {
    const candidates = tags.filter((tag) => tag.startsWith(`v${version}-`)).map((tag) => tagFormat.exec(tag));
    if (candidates.some((match) => channels.indexOf(match[4]) > channels.indexOf(channel))) {
      throw new Error("This version already has a later prerelease channel.");
    }
    const numbers = candidates.filter((match) => match[4] === channel).map((match) => Number(match[5]));
    version = `${version}-${channel}.${Math.max(0, ...numbers) + 1}`;
  }
  const tag = `v${version}`;
  if (tags.includes(tag)) {
    throw new Error(`${tag} already exists.`);
  }

  const curatedLines = new Set([...curated.values()].flat().concat([...publicNotes]));
  const categorizedNotes = Object.keys(categories).flatMap((name) => {
    const lines = changes.filter(({ group }) => group === name).map(({ note }) => `- ${note}`)
      .filter((line) => !curatedLines.has(line));
    const entries = [...new Set([...(curated.get(name) ?? []), ...lines])].join("\n").trim();
    return entries ? [`### ${name}\n\n${entries}`] : [];
  });
  const publicSection = publicNotes.size > 0 ? [`### 공지사항\n\n${[...publicNotes].join("\n")}`] : [];
  const notes = [...publicSection, ...categorizedNotes].join("\n\n");

  if (channel === "stable") {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" }).format();
    const history = log.slice(unreleased.index + unreleased[0].length);
    const entry = `## [Unreleased]\n\n## [${version}] - ${date}\n\n${notes}\n`;
    writeFileSync(changelogPath, `${log.slice(0, unreleased.index)}${entry}${history ? `\n${history}` : ""}`);
  }
  writeVersionFiles(files, version);
  writeFileSync(notesPath, `${notes}\n`);
  return { version, tag, prerelease: channel !== "stable" };
}

const [channel, notesPath, retryTag] = process.argv.slice(2);
if (channel === "set") {
  if (retryTag) {
    throw new Error("Pass exactly one version to pnpm desktop:version.");
  }
  setVersion(notesPath);
} else if (!channels.includes(channel) || !notesPath || (retryTag && !tagFormat.test(retryTag))) {
  throw new Error("Usage: release-version.mjs <stable|alpha|beta|rc> <notes-path> [existing-tag]");
} else if (retryTag) {
  const ref = `refs/tags/${retryTag}`;
  git("merge-base", "--is-ancestor", ref, "HEAD");
  if (git("cat-file", "-t", ref) !== "tag") {
    throw new Error("Select an annotated release tag to retry.");
  }
  git("switch", "--detach", ref);
  const version = retryTag.slice(1);
  if (readVersionFiles().config.version !== version) {
    throw new Error("The tag must match the desktop version.");
  }
  writeFileSync(notesPath, `${git("for-each-ref", "--format=%(contents)", ref)}\n`);
  console.log(JSON.stringify({ version, tag: retryTag, prerelease: !stable.test(version) }));
} else {
  console.log(JSON.stringify(prepare(channel, notesPath)));
}
