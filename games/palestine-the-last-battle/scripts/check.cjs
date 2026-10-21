const fs = require("node:fs"),
  cp = require("node:child_process");
for (const file of fs.readdirSync("dist").filter((f) => f.endsWith(".js"))) {
  cp.execFileSync(process.execPath, ["--check", "dist/" + file], {
    stdio: "inherit",
  });
}
console.log("JavaScript syntax checks passed.");
