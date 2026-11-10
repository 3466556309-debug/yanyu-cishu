import { mkdir, open, readFile, rename, stat, copyFile, chmod } from 'node:fs/promises';
import path from 'node:path';

function createEmptyDb() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    users: {},
    sessions: {},
  };
}

export class JsonStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.data = null;
    this.queue = Promise.resolve();
    this.lastBackupDay = '';
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      await stat(this.file);
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.users || !parsed.sessions) {
        throw new Error('数据文件结构不正确');
      }
      this.data = parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.data = createEmptyDb();
        await this.writeAtomic();
      } else {
        throw new Error(`读取数据文件失败，已停止以免覆盖现有数据：${error.message}`);
      }
    }
    this.cleanExpiredSessions();
    return this;
  }

  cleanExpiredSessions() {
    const now = Date.now();
    for (const [hash, session] of Object.entries(this.data.sessions || {})) {
      if (!session || !session.expiresAt || Date.parse(session.expiresAt) <= now) {
        delete this.data.sessions[hash];
      }
    }
  }

  async backupOncePerDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastBackupDay === today) return;
    try {
      await stat(this.file);
      const backupDir = path.join(path.dirname(this.file), 'backups');
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      const target = path.join(backupDir, `app-data-${today}.json`);
      try {
        await stat(target);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await copyFile(this.file, target);
        await chmod(target, 0o600);
      }
      this.lastBackupDay = today;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async writeAtomic() {
    await this.backupOncePerDay();
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(this.data)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, this.file);
  }

  /**
   * 串行处理写入，先改副本，写盘成功后再替换内存数据，避免半截数据。
   */
  async mutate(mutator) {
    const run = this.queue.then(async () => {
      const previous = this.data;
      const draft = structuredClone(this.data);
      const result = await mutator(draft);
      if (result?.dirty === false) return result.value;
      this.data = draft;
      try {
        await this.writeAtomic();
      } catch (error) {
        this.data = previous;
        throw error;
      }
      return result?.value;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async read(reader) {
    const run = this.queue.then(() => reader(structuredClone(this.data)));
    this.queue = run.catch(() => {});
    return run;
  }
}
