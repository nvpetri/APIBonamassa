import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const parse = (value) => {
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return value.split(".").map(BigInt);
};
const current = parse(pkg.version);
assert.equal(lock.version, pkg.version, "Atualize package-lock.json.");
assert.equal(
  lock.packages[""].version,
  pkg.version,
  "Atualize a raiz do lockfile.",
);
assert.ok(
  read("CHANGELOG.md")
    .split("\n")
    .some((line) => line.startsWith(`## [${pkg.version}] - `)),
  "Documente a versão atual no CHANGELOG.md.",
);

// CI supplies the PR base or main's previous head, never a release inferred
// from commit messages. Documentation/test-only changes can retain a version.
const base = process.env.RELEASE_BASE_SHA;
if (base && !/^0+$/.test(base)) {
  assert.match(
    base,
    /^[a-f0-9]{40}$/i,
    "RELEASE_BASE_SHA deve ser um SHA completo.",
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const previous = parse(
    JSON.parse(git("show", `${base}:package.json`)).version,
  );
  const firstDifference = current.findIndex(
    (part, index) => part !== previous[index],
  );
  assert.ok(
    firstDifference < 0 || current[firstDifference] > previous[firstDifference],
    "A versão não pode diminuir.",
  );
  const changed = git(
    "diff",
    "--name-only",
    base,
    "--",
    "src",
    "prisma",
    "scripts",
    "package.json",
    "package-lock.json",
    "Dockerfile",
    ".github/workflows/backup.yml",
  ).trim();
  assert.ok(
    !changed || firstDifference >= 0,
    "Código/contrato alterado sem nova versão. Use npm version patch ou minor --no-git-tag-version e atualize o changelog.",
  );
}
console.log(
  `Release ${pkg.version}: pacote, lockfile e changelog consistentes.`,
);
