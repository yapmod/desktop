import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { ManualChangelog, updateCargoVersion, section, promote } from "./manual-changelog.mjs";
import { parseConventionalCommits } from "release-please/build/src/commit.js";
import { Version } from "release-please/build/src/version.js";
import { Merge } from "release-please/build/src/plugins/merge.js";
import { TagName } from "release-please/build/src/util/tag-name.js";
import { releaseMessage } from "./announce-release.mjs";

const notes = "### Added\n\n- Choose where to save downloaded files.";
const log = `# Changelog\n\n## [Unreleased]\n\n${notes}\n\n## v1.1.0\n\n- Existing history.\n`;

test("release proposal synchronizes Node and Cargo versions and preserves authored notes", async () => {
  const github = {
    repository: { owner: "yapmod", repo: "desktop" },
    getFileContentsOnBranch: async (path) => ({
      parsedContent: path === "CHANGELOG.md" ? log : readFileSync(path, "utf8"),
    }),
  };
  const strategy = new ManualChangelog({
    github,
    targetBranch: "main",
    includeComponentInTag: false,
  });
  const pr = await strategy.buildReleasePullRequest(
    parseConventionalCommits([
      { sha: "abc", message: "feat: automated wording", files: ["src-tauri/src/downloads.rs"] },
    ]),
    { tag: new TagName(Version.parse("1.1.0")), sha: "previous", notes: "" },
  );
  assert.equal(pr.version.toString(), "1.2.0");
  assert.ok(pr.body.toString().includes(notes));
  assert.ok(!pr.body.toString().includes("automated wording"));
  for (const path of ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    const updated = pr.updates
      .find((update) => update.path === path)
      .updater.updateContent(readFileSync(path, "utf8"));
    assert.ok(updated.includes("1.2.0"));
  }
  const updated = pr.updates
    .find((update) => update.path === "CHANGELOG.md")
    .updater.updateContent(log);
  assert.equal(section(updated, "Unreleased").body, "");
  assert.equal(section(updated, "1.2.0").body, notes);
  github.getFileContentsOnBranch = async (_path, ref) => {
    assert.equal(ref, "approved");
    return { parsedContent: updated };
  };
  // Production merges candidates into a componentless manifest PR.
  const [candidate] = await new Merge(github, "main", {
    ".": { releaseType: "manual-node" },
  }, { forceMerge: true }).run([{ path: ".", config: { releaseType: "manual-node" }, pullRequest: pr }]);
  const merged = candidate.pullRequest;
  assert.equal(merged.headRefName, "release-please--branches--main");
  const release = await strategy.buildRelease({
    title: merged.title.toString(),
    body: merged.body.toString(),
    headBranchName: merged.headRefName,
    sha: "approved",
  });
  assert.ok(release, "The merged manifest PR must produce a release");
  assert.equal(release.tag.toString(), "v1.2.0");
  assert.equal(release.sha, "approved");
  assert.ok(release.notes.endsWith(notes));
});

test("Cargo updates only touch the desktop package", () => {
  const source =
    '[[package]]\nname = "dependency"\nversion = "1.1.0"\n\n[[package]]\nname = "yapmod-desktop"\nversion = "1.1.0"\n';
  assert.equal(
    updateCargoVersion(source, "1.2.0", true),
    source.replace(
      'name = "yapmod-desktop"\nversion = "1.1.0"',
      'name = "yapmod-desktop"\nversion = "1.2.0"',
    ),
  );
  assert.throws(() => updateCargoVersion("", "1.2.0", true));
  assert.throws(() => promote("# Changelog\n\n## [Unreleased]\n", "## [1.2.0]"));
});

test("Python publishing recognizes both historical and new changelog headings", () => {
  execFileSync(process.env.PYTHON || "python3", [
    "-c",
    `import runpy
import tempfile
from pathlib import Path

section = runpy.run_path('scripts/release.py')['changelog_section']
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    section.__globals__['ROOT'] = root
    changelog = root / 'CHANGELOG.md'
    for heading, title in [
        ('Unreleased', 'Unreleased'),
        ('[Unreleased]', 'Unreleased'),
        ('v1.1.0', 'v1.1.0'),
        ('[1.2.0]', 'v1.2.0'),
        ('[1.2.0] — 2026-11-22', 'v1.2.0'),
    ]:
        changelog.write_text(f'# Changelog\\n\\n## {heading}\\n\\n- Authored notes.\\n\\n## v1.0.0\\n\\n- Older notes.\\n', encoding='utf-8')
        assert section(title) == '- Authored notes.', heading

    changelog.write_text('# Changelog\\n\\n## [Unreleased]\\n\\n## [1.2.0] — 2026-11-22\\n\\n- Released notes.\\n', encoding='utf-8')
    assert section('v1.2.0') == '- Released notes.'
    for title in ['Unreleased', 'v9.9.9']:
        try:
            section(title)
        except ValueError as error:
            assert 'Missing release notes' in str(error)
        else:
            raise AssertionError(f'Expected missing notes to be rejected: {title}')
`,
  ]);
});

test("desktop announcements retain notes, ping only the chosen role, and reject plugin releases", () => {
  const release = {
    tag_name: "v1.2.0",
    html_url: "https://github.com/yapmod/desktop/releases/tag/v1.2.0",
    body: notes,
    draft: false,
    prerelease: false,
  };
  const role = "33367aaa-f65b-4e1c-a870-8f0041a437dc";
  const message = releaseMessage(release, role);
  assert.ok(message.content.includes("Yapmod Desktop v1.2.0"));
  assert.ok(message.embeds[0].description.includes("- Choose where to save downloaded files."));
  assert.deepEqual(message.allowed_mentions, { parse: [], roles: [role] });
  assert.throws(() =>
    releaseMessage({ ...release, tag_name: "plugins-v1", prerelease: true }, role),
  );
});
