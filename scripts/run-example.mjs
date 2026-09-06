import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--tarball") {
    const value = process.argv[++index];
    if (!value || value.startsWith("--") || options.tarball) {
      throw new Error("--tarball requires one path");
    }
    options.tarball = resolve(value);
  } else if (argument === "--serve" || argument === "--browser") {
    options[argument.slice(2)] = true;
  } else {
    throw new Error(`Unknown option: ${argument}`);
  }
}
if (options.serve && options.browser) throw new Error("Choose --serve or --browser");

function run(command, args, cwd, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Command failed (${signal ?? code}): ${command}`));
    });
  });
}

function npm(args, cwd) {
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error("Run this script through npm run example or example:check");
  return run(process.execPath, [executable, ...args], cwd);
}

const temporary = await mkdtemp(join(tmpdir(), "selection-example-"));
let server;
try {
  const example = join(temporary, "example");
  await cp(join(root, "examples", "server-table"), example, {
    recursive: true,
    filter: (path) =>
      !path.split(/[\\/]/).includes("node_modules") && !path.endsWith("package-lock.json"),
  });
  let tarball = options.tarball;
  if (!tarball) {
    await npm(["run", "build"], root);
    await npm(["pack", "--ignore-scripts", "--pack-destination", temporary, "--silent"], root);
    const files = (await readdir(temporary)).filter((file) => file.endsWith(".tgz"));
    if (files.length !== 1) throw new Error("Expected one packed artifact");
    tarball = join(temporary, files[0]);
  }
  await npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], example);
  if (options.serve) {
    const { createDemoServer } = await import(pathToFileURL(join(example, "server.mjs")).href);
    server = createDemoServer();
    server.listen(Number(process.env.PORT ?? 4173), "127.0.0.1");
    await once(server, "listening");
    process.stdout.write(
      `Table example: http://127.0.0.1:${server.address().port}\nPress Ctrl+C to stop.\n`,
    );
    await new Promise((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  } else {
    await run(process.execPath, ["--test", "server.test.mjs", "controller.test.mjs"], example);
    if (options.browser) {
      await run(
        process.execPath,
        [join(root, "node_modules", "@playwright", "test", "cli.js"), "test"],
        root,
        {
          ...process.env,
          SAM_EXAMPLE_DIRECTORY: example,
        },
      );
    }
  }
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  await rm(temporary, { recursive: true, force: true });
}
