import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Moves a staged render dir to a work location, runs a command there, retrieves
 * a result file, and can capture a command's stdout on the host. Two
 * implementations: LocalTransport (same machine, used for localhost and
 * hermetic tests) and SshTransport (a remote host over ssh + rsync). Every step
 * rejects loudly, naming the step, so a failure is a clear diagnostic.
 */
export interface Transport {
  mkdirp(dir: string): Promise<void>;
  pushDir(localDir: string, remoteDir: string): Promise<void>;
  /** Run a command in the given work dir and return its stdout. */
  exec(cwd: string, cmd: string[]): Promise<string>;
  /** Run a command on the host and return its stdout (used for host preflight checks). */
  capture(cmd: string[]): Promise<string>;
  pullFile(remoteFile: string, localFile: string): Promise<void>;
  remove(dir: string): Promise<void>;
  describe(): string;
}

function run(
  bin: string,
  args: string[],
  step: string,
  opts: { cwd?: string; capture?: boolean } = {},
): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, opts.cwd ? { cwd: opts.cwd } : {});
    let out = "";
    let err = "";
    if (opts.capture) p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d));
    p.on("error", (e) => rej(new Error(`[remote-render] ${step} could not start: ${e.message}`)));
    p.on("close", (code) =>
      code === 0 ? res(out) : rej(new Error(`[remote-render] ${step} exited ${code}: ${err.slice(0, 600).trim()}`)),
    );
  });
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class LocalTransport implements Transport {
  describe(): string {
    return "local";
  }
  async mkdirp(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }
  async pushDir(localDir: string, remoteDir: string): Promise<void> {
    await mkdir(remoteDir, { recursive: true });
    await cp(localDir, remoteDir, { recursive: true });
  }
  async exec(cwd: string, cmd: string[]): Promise<string> {
    return run(cmd[0]!, cmd.slice(1), `exec ${cmd[0]}`, { cwd, capture: true });
  }
  async capture(cmd: string[]): Promise<string> {
    return run(cmd[0]!, cmd.slice(1), `capture ${cmd[0]}`, { capture: true });
  }
  async pullFile(remoteFile: string, localFile: string): Promise<void> {
    await mkdir(dirname(localFile), { recursive: true });
    await cp(remoteFile, localFile);
  }
  async remove(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }
}

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
const rsyncSsh = `ssh ${SSH_OPTS.join(" ")}`;

export class SshTransport implements Transport {
  constructor(private readonly host: string) {}
  describe(): string {
    return `ssh:${this.host}`;
  }
  async mkdirp(dir: string): Promise<void> {
    await run("ssh", [...SSH_OPTS, this.host, `mkdir -p ${shQuote(dir)}`], "ssh mkdirp");
  }
  async pushDir(localDir: string, remoteDir: string): Promise<void> {
    await run("ssh", [...SSH_OPTS, this.host, `mkdir -p ${shQuote(remoteDir)}`], "ssh mkdirp");
    // rsync does NOT strip shell quotes from the remote path; use -s (--protect-args)
    // to protect it from remote-shell word-splitting instead of manual quoting.
    await run("rsync", ["-a", "-s", "-e", rsyncSsh, `${localDir}/`, `${this.host}:${remoteDir}/`], "rsync push");
  }
  async exec(cwd: string, cmd: string[]): Promise<string> {
    return run("ssh", [...SSH_OPTS, this.host, `cd ${shQuote(cwd)} && ${cmd.map(shQuote).join(" ")}`], "ssh exec", {
      capture: true,
    });
  }
  async capture(cmd: string[]): Promise<string> {
    return run("ssh", [...SSH_OPTS, this.host, cmd.map(shQuote).join(" ")], "ssh capture", { capture: true });
  }
  async pullFile(remoteFile: string, localFile: string): Promise<void> {
    await mkdir(dirname(localFile), { recursive: true });
    await run("rsync", ["-a", "-s", "-e", rsyncSsh, `${this.host}:${remoteFile}`, localFile], "rsync pull");
  }
  async remove(dir: string): Promise<void> {
    await run("ssh", [...SSH_OPTS, this.host, `rm -rf ${shQuote(dir)}`], "ssh remove");
  }
}
