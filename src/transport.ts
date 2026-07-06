import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Moves a staged render dir to a work location, runs a command there, and
 * retrieves a result file. Two implementations: LocalTransport (same machine,
 * used for localhost and hermetic tests) and SshTransport (a remote host over
 * ssh + rsync). Every step rejects loudly, naming the step, so a failure is a
 * clear diagnostic rather than a silent partial run.
 */
export interface Transport {
  mkdirp(dir: string): Promise<void>;
  pushDir(localDir: string, remoteDir: string): Promise<void>;
  exec(cwd: string, cmd: string[]): Promise<void>;
  pullFile(remoteFile: string, localFile: string): Promise<void>;
  remove(dir: string): Promise<void>;
  describe(): string;
}

function run(bin: string, args: string[], step: string, cwd?: string): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, cwd ? { cwd } : {});
    let err = "";
    p.stderr?.on("data", (d) => (err += d));
    p.on("error", (e) => rej(new Error(`[remote-render] ${step} could not start: ${e.message}`)));
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`[remote-render] ${step} exited ${code}: ${err.slice(0, 600).trim()}`)),
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
  async exec(cwd: string, cmd: string[]): Promise<void> {
    await run(cmd[0]!, cmd.slice(1), `exec ${cmd[0]}`, cwd);
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

export class SshTransport implements Transport {
  constructor(private readonly host: string) {}
  describe(): string {
    return `ssh:${this.host}`;
  }
  async mkdirp(dir: string): Promise<void> {
    await run("ssh", [...SSH_OPTS, this.host, "mkdir", "-p", dir], "ssh mkdirp");
  }
  async pushDir(localDir: string, remoteDir: string): Promise<void> {
    await run("ssh", [...SSH_OPTS, this.host, "mkdir", "-p", remoteDir], "ssh mkdirp");
    await run("rsync", ["-a", "-e", `ssh ${SSH_OPTS.join(" ")}`, `${localDir}/`, `${this.host}:${remoteDir}/`], "rsync push");
  }
  async exec(cwd: string, cmd: string[]): Promise<void> {
    const remote = `cd ${shQuote(cwd)} && ${cmd.map(shQuote).join(" ")}`;
    await run("ssh", [...SSH_OPTS, this.host, remote], "ssh exec");
  }
  async pullFile(remoteFile: string, localFile: string): Promise<void> {
    await mkdir(dirname(localFile), { recursive: true });
    await run("rsync", ["-a", "-e", `ssh ${SSH_OPTS.join(" ")}`, `${this.host}:${remoteFile}`, localFile], "rsync pull");
  }
  async remove(dir: string): Promise<void> {
    await run("ssh", [...SSH_OPTS, this.host, "rm", "-rf", dir], "ssh remove");
  }
}
